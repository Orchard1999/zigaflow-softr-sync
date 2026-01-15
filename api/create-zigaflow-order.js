// /api/create-zigaflow-order.js
// VERSION 5 - Full Excel-style field mapping

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
      message: 'Zigaflow Create Order - v5 (full mapping)',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ZIGAFLOW_API_KEY = process.env.ZIGAFLOW_API_KEY;
  const ZIGAFLOW_BASE_URL = process.env.ZIGAFLOW_BASE_URL;

  try {
    const body = req.body || {};
    const lineItems = body.lineItems || [];

    // ============================================
    // STEP 1: Calculate Section Names (grouped by product code)
    // ============================================
    const productCodeGroups = {};
    
    lineItems.forEach(item => {
      const code = item.productCode || '';
      if (!productCodeGroups[code]) {
        productCodeGroups[code] = {
          productRange: item.productRange || '',
          finish: item.finish || '',
          backing: item.backing || '',
          size: item.size || '',
          totalSheets: 0,
          totalPrints: 0,
          orderMultiple: parseInt(item.orderMultiple) || 1
        };
      }
      productCodeGroups[code].totalSheets += parseInt(item.sheets) || 0;
      productCodeGroups[code].totalPrints += parseInt(item.prints) || 0;
    });

    // Convert prints to sheets when prints >= order multiple
    Object.keys(productCodeGroups).forEach(code => {
      const group = productCodeGroups[code];
      const orderMultiple = group.orderMultiple;
      
      if (group.totalPrints >= orderMultiple && orderMultiple > 0) {
        const additionalSheets = Math.floor(group.totalPrints / orderMultiple);
        group.totalSheets += additionalSheets;
        group.totalPrints = group.totalPrints % orderMultiple;
      }
    });

    // Build section names
    const sectionNames = {};
    Object.keys(productCodeGroups).forEach(code => {
      const g = productCodeGroups[code];
      sectionNames[code] = `${g.productRange} - ${g.finish} - ${g.backing} - ${g.size} - Total Sheets (${g.totalSheets}), Total Prints (${g.totalPrints})`;
    });

    // ============================================
    // STEP 2: Build Job Payload (Excel columns A-V, AX-BC)
    // ============================================
    const jobPayload = {
      // Column D: Company
      client: {
        id: body.zigaflowClientId || '',
        value: body.customerName || ''
      },
      // Contact (if provided)
      ...(body.mainContactId && {
        contact: {
          id: body.mainContactId,
          value: body.mainContactName || ''
        }
      }),
      // Column A: ID / Reference
      reference: 'ORC-O',
      // Column O: Client PO
      client_reference: body.poNumber || '',
      po_number: body.poNumber || '',
      // Column B: Pre-Build / Template
      template_name: 'Job Upload Template',
      // Column K: End Date
      estimated_delivery: body.requiredDeliveryDate 
        ? new Date(body.requiredDeliveryDate).toISOString() 
        : null,
      // Column J: Start Date
      estimated_start: body.orderDate 
        ? new Date(body.orderDate).toISOString() 
        : new Date().toISOString(),
      // Customer message
      description: body.customerMessage || '',
      // Custom fields (Columns S-V for aggregations, AX-BB for shipping)
      custom_fields: [
        // Column S: Custom[Gloss4.8mm]
        { label: 'Gloss4.8mm', value: String(body.aggregations?.gloss4mm || 0) },
        // Column T: Custom[Gloss3m]
        { label: 'Gloss3m', value: String(body.aggregations?.gloss3mm || 0) },
        // Column U: Custom[Matt4mm]
        { label: 'Matt4mm', value: String(body.aggregations?.matt4mm || 0) },
        // Column V: Custom[Matt3mm]
        { label: 'Matt3mm', value: String(body.aggregations?.matt3mm || 0) },
        // Column AX: Custom[ShiptoContactName]
        { label: 'ShiptoContactName', value: body.deliveryDetails?.contactName || '' },
        // Column AY: Custom[ShiptoCompanyName]
        { label: 'ShiptoCompanyName', value: body.deliveryDetails?.companyName || '' },
        // Column AZ: Custom[ShiptoAddress]
        { label: 'ShiptoAddress', value: body.deliveryDetails?.address || '' },
        // Column BA: Custom[ShiptoNumber]
        { label: 'ShiptoNumber', value: String(body.deliveryDetails?.number || '') },
        // Column BB: Custom[ShiptoEmail]
        { label: 'ShiptoEmail', value: body.deliveryDetails?.email || '' }
      ],
      // Delivery address
      one_off_delivery_address: {
        address1: body.deliveryDetails?.companyName || '',
        address2: body.deliveryDetails?.address || '',
        postcode: ''
      }
    };

    // ============================================
    // STEP 3: Create Job in Zigaflow
    // ============================================
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
    try { jobResult = JSON.parse(jobResponseText); } catch(e) { jobResult = jobResponseText; }

    if (!jobResponse.ok) {
      return res.status(200).json({
        success: false,
        error: 'Failed to create job',
        zigaflowStatus: jobResponse.status,
        zigaflowResponse: jobResult,
        sentPayload: jobPayload
      });
    }

    const jobId = jobResult.id;
    const jobNumber = jobResult.number || jobResult.job_number;

    // ============================================
    // STEP 4: Add Line Items with Full Mapping (Excel columns W-AV)
    // ============================================
    const lineItemResults = [];

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      const isFirstRow = i === 0;

      // Column W: Section Name
      const sectionName = sectionNames[item.productCode] || '';

      // Column Z: Detailed Description
      // Format: "SIZE, FINISH, THICKNESS, BACKING - DESIGN"
      const detailedDescription = `${item.size || ''}, ${item.finish || ''}, ${item.thickness || ''}, ${item.backing || ''} - ${item.design || ''}`;

      // Column AC: Sales Account Code
      const salesAccountCode = item.salesCode ? `${item.salesCode} - Melamine Sales` : '';

      // Build line item payload with ALL fields
      const linePayload = {
        // Column X: Item Code
        product_code: item.productCode || '',
        // Column Y: Item Description (Design)
        description: item.design || '',
        // Column AQ: Qty
        quantity: parseInt(item.quantity) || 0,
        // Column AA: Category
        category: item.productRange || '',
        // Price
        price: parseFloat(item.price) || 0,
        // Column W: Section Name
        section_name: sectionName,
        // Column Z: Detailed Description
        detailed_description: detailedDescription,
        // Column AB: Unit
        unit: 1,
        // Column AC: Sales Account Code
        sales_account_code: salesAccountCode,
        // Column AJ: Sales Tax Code
        sales_tax_code: '20% (VAT on Income)',
        // Column AR: Item Custom[Sheets]
        sheets: parseInt(item.sheets) || 0,
        // Column AS: Item Custom[Prints]
        prints: parseInt(item.prints) || 0,
        // Column AT: Item Custom[WoodgrainType]
        woodgrain_type: item.woodgrainType || '',
        // Column AU: Item Custom[WoodgrainSheets]
        woodgrain_sheets: parseInt(item.woodgrainSheets) || 0,
        // Column AV: Item Custom[WoodgrainPrints]
        woodgrain_prints: parseInt(item.woodgrainPrints) || 0
      };

      // Try to add the line item
      const lineResponse = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs/${jobId}/addItem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': ZIGAFLOW_API_KEY
        },
        body: JSON.stringify(linePayload)
      });

      const lineText = await lineResponse.text();
      let lineResult;
      try { lineResult = JSON.parse(lineText); } catch(e) { lineResult = lineText; }

      lineItemResults.push({
        index: i + 1,
        status: lineResponse.status,
        ok: lineResponse.ok,
        sent: linePayload,
        result: lineResult
      });
    }

    // ============================================
    // STEP 5: Return Results
    // ============================================
    return res.status(200).json({
      success: true,
      jobId: jobId,
      jobNumber: jobNumber,
      zigaflowResponse: jobResult,
      lineItemsProcessed: lineItemResults.length,
      lineItemsSuccessful: lineItemResults.filter(r => r.ok).length,
      lineItems: lineItemResults,
      sectionNames: sectionNames
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
