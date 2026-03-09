// /api/create-zigaflow-order.js
// VERSION 16 - Email-to-UUID fallback for assigned_user

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ 
      message: 'Zigaflow Create Order - v16 (email-to-UUID fallback)',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ZIGAFLOW_API_KEY = process.env.ZIGAFLOW_API_KEY;
  const ZIGAFLOW_BASE_URL = process.env.ZIGAFLOW_BASE_URL;

  const EMAIL_TO_UUID = {
    'ben@orchard-melamine.co.uk': '46c2aaa0-a23a-49eb-8c29-439b63ed992c',
    'coasters@orchard-melamine.co.uk': 'ed30b063-e0c9-40ec-89e3-df669029d623',
    'accounts@orchard-melamine.co.uk': '3e69ac02-24eb-42b7-ae1a-dedcd3aed0e4',
    'rachel@orchard-melamine.co.uk': '7af586da-ed67-426f-b762-6c0d3f6a5539',
    'enquiries@orchard-melamine.co.uk': 'c766531c-f48b-42c2-9e9d-74e535494a62'
  };

  try {
    const body = req.body || {};
    const lineItems = body.lineItems || [];
    const sections = body.sections || [];
    const poNumber = body.poNumber || '';

    // Resolve assigned user UUID - direct ID first, then email lookup
    const assignedUserId = body.accountManagerId || EMAIL_TO_UUID[(body.assignedUserEmail || '').toLowerCase()] || '';

    // ============================================
    // STEP 1: Create Job
    // ============================================
    const jobPayload = {
      client: {
        id: body.zigaflowClientId || '',
        value: body.customerName || ''
      },
      ...(body.mainContactId && {
        contact: {
          id: body.mainContactId,
          value: body.mainContactName || ''
        }
      }),
      ...(assignedUserId && {
        assigned_user: {
          id: assignedUserId,
          value: body.assignedUserEmail || ''
        }
      }),
      reference: 'ORC-O',
      client_reference: poNumber,
      po_number: poNumber,
      template_name: 'Job API Template',
      estimated_delivery: body.requiredDeliveryDate 
        ? new Date(body.requiredDeliveryDate).toISOString() 
        : null,
      estimated_start: body.orderDate 
        ? new Date(body.orderDate).toISOString() 
        : new Date().toISOString(),
      description: body.customerMessage || '',
      custom_fields: [
        { label: 'Gloss4mm', value: String(body.aggregations?.gloss4mm || 0) },
        { label: 'Gloss3mm', value: String(body.aggregations?.gloss3mm || 0) },
        { label: 'Matt4mm', value: String(body.aggregations?.matt4mm || 0) },
        { label: 'Matt3mm', value: String(body.aggregations?.matt3mm || 0) },
        { label: 'ShiptoContactName', value: body.deliveryDetails?.contactName || '' },
        { label: 'ShiptoCompanyName', value: body.deliveryDetails?.companyName || '' },
        { label: 'ShiptoAddress', value: body.deliveryDetails?.address || '' },
        { label: 'ShiptoNumber', value: String(body.deliveryDetails?.number || '') },
        { label: 'ShiptoEmail', value: body.deliveryDetails?.email || '' },
        { label: 'CustomerMessage', value: body.customerMessage || '' }
      ],
      one_off_delivery_address: {
        address1: body.deliveryDetails?.companyName || '',
        address2: body.deliveryDetails?.address || '',
        postcode: ''
      }
    };

    const jobResponse = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ZIGAFLOW_API_KEY
      },
      body: JSON.stringify(jobPayload)
    });

    const jobResponseText = await jobResponse.text();
    let jobResult;
    try { 
      jobResult = JSON.parse(jobResponseText); 
    } catch(e) { 
      jobResult = jobResponseText; 
    }

    if (!jobResponse.ok) {
      return res.status(200).json({
        success: false,
        step: 'CREATE_JOB',
        zigaflowStatus: jobResponse.status,
        zigaflowResponse: jobResult,
        payloadSent: jobPayload
      });
    }

    const jobId = jobResult.id;
    const jobNumber = jobResult.number;

    // ============================================
    // STEP 2: Create Sections (PARALLEL)
    // ============================================
    const sectionPromises = sections.map(async (section, i) => {
      const sectionPayload = {
        name: section.name || '',
        style_name: section.style_name || 'Products'
      };

      try {
        const sectionResponse = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs/${jobId}/addSection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ZIGAFLOW_API_KEY
          },
          body: JSON.stringify(sectionPayload)
        });

        const sectionText = await sectionResponse.text();
        let sectionResult;
        try { 
          sectionResult = JSON.parse(sectionText); 
        } catch(e) { 
          sectionResult = sectionText; 
        }

        return {
          index: i + 1,
          name: section.name,
          style: section.style_name,
          id: sectionResponse.ok && sectionResult.id ? sectionResult.id : null,
          response: {
            status: sectionResponse.status,
            ok: sectionResponse.ok,
            result: sectionResult
          }
        };
      } catch (err) {
        return {
          index: i + 1,
          name: section.name,
          style: section.style_name,
          id: null,
          response: {
            status: 500,
            ok: false,
            result: err.message
          }
        };
      }
    });

    const sectionResults = await Promise.all(sectionPromises);

    // Build section ID map
    const sectionIdMap = {};
    sectionResults.forEach(result => {
      if (result.id) {
        sectionIdMap[result.name] = result.id;
      }
    });

    // ============================================
    // STEP 3: Add Line Items (PARALLEL)
    // ============================================
    const itemPromises = lineItems.map(async (item, i) => {
      const sectionId = sectionIdMap[item.sectionName] || null;

      const itemPayload = {
        product_code: item.productCode || '',
        description: item.design || '',
        quantity: parseInt(item.quantity) || 0,
        price: parseFloat(item.price) || 0,
        unit_price: parseFloat(item.price) || 0,
        category: item.productRange || '',
        sales_account_code: item.salesCode || '',
        sales_tax_code: '20% (VAT on Income)',
        ...(sectionId && { section_id: sectionId }),
        custom_fields: [
          { label: 'Sheets', value: String(item.sheets || 0) },
          { label: 'Prints', value: String(item.prints || 0) },
          { label: 'WoodgrainType', value: item.woodgrainType || '' },
          { label: 'WoodgrainSheets', value: String(item.woodgrainSheets || 0) },
          { label: 'WoodgrainPrints', value: String(item.woodgrainPrints || 0) },
          { label: 'DetailedDescriptionD', value: item.detailedDescription || '' }
        ]
      };

      try {
        const addResponse = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs/${jobId}/addItem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ZIGAFLOW_API_KEY
          },
          body: JSON.stringify(itemPayload)
        });

        const addText = await addResponse.text();
        let addResult;
        try { 
          addResult = JSON.parse(addText); 
        } catch(e) { 
          addResult = addText; 
        }

        return {
          index: i + 1,
          design: item.design,
          productCode: item.productCode,
          sectionName: item.sectionName,
          sectionId: sectionId,
          response: {
            status: addResponse.status,
            ok: addResponse.ok,
            result: addResult
          }
        };
      } catch (err) {
        return {
          index: i + 1,
          design: item.design,
          productCode: item.productCode,
          sectionName: item.sectionName,
          sectionId: sectionId,
          response: {
            status: 500,
            ok: false,
            result: err.message
          }
        };
      }
    });

    const itemResults = await Promise.all(itemPromises);

    // ============================================
    // STEP 4: Return Results
    // ============================================
    return res.status(200).json({
      success: true,
      jobId: jobId,
      jobNumber: jobNumber,
      assignedUserId: assignedUserId || 'not resolved',
      assignedUserEmail: body.assignedUserEmail || 'not provided',
      contactId: body.mainContactId || 'not provided',
      sectionsCreated: sectionResults.filter(s => s.id).length,
      sectionResults: sectionResults,
      itemsCreated: itemResults.filter(i => i.response.ok).length,
      itemResults: itemResults,
      message: `Created job ${jobNumber} with ${sectionResults.length} sections and ${itemResults.length} items`
    });

  } catch (error) {
    console.error('Full error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
