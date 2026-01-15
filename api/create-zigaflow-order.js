// /api/create-zigaflow-order.js
// VERSION 4 - Correct auth + handle missing contact ID

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
      message: 'Zigaflow Create Order - v4',
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
    
    // Build the job payload
    // Note: If contact ID is missing, we might need to omit the contact field
    // or use a default contact
    const jobPayload = {
      client: {
        id: body.zigaflowClientId || '',
        value: body.customerName || ''
      },
      reference: 'ORC-O',
      client_reference: body.poNumber || '',
      po_number: body.poNumber || '',
      template_name: 'Job Upload Template',
      estimated_delivery: body.requiredDeliveryDate 
        ? new Date(body.requiredDeliveryDate).toISOString() 
        : null,
      estimated_start: body.orderDate 
        ? new Date(body.orderDate).toISOString() 
        : new Date().toISOString(),
      description: body.customerMessage || '',
      custom_fields: [
        { label: 'Gloss3mm', value: String(body.aggregations?.gloss3mm || 0) },
        { label: 'Gloss4mm', value: String(body.aggregations?.gloss4mm || 0) },
        { label: 'Matt3mm', value: String(body.aggregations?.matt3mm || 0) },
        { label: 'Matt4mm', value: String(body.aggregations?.matt4mm || 0) },
        { label: 'ShiptoContactName', value: body.deliveryDetails?.contactName || '' },
        { label: 'ShiptoCompanyName', value: body.deliveryDetails?.companyName || '' },
        { label: 'ShiptoAddress', value: body.deliveryDetails?.address || '' },
        { label: 'ShiptoEmail', value: body.deliveryDetails?.email || '' },
        { label: 'ShiptoNumber', value: String(body.deliveryDetails?.number || '') }
      ],
      one_off_delivery_address: {
        address1: body.deliveryDetails?.companyName || '',
        address2: body.deliveryDetails?.address || '',
        postcode: ''
      }
    };

    // Only add contact if we have a contact ID
    if (body.mainContactId) {
      jobPayload.contact = {
        id: body.mainContactId,
        value: body.mainContactName || ''
      };
    }

    // Call Zigaflow with X-API-Key header (the correct auth method!)
    const response = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ZIGAFLOW_API_KEY
      },
      body: JSON.stringify(jobPayload)
    });

    const responseText = await response.text();
    let result;
    try { result = JSON.parse(responseText); } catch(e) { result = responseText; }

    // If successful, try to add line items
    if (response.ok && result.id) {
      const jobId = result.id;
      const lineItems = body.lineItems || [];
      const lineItemResults = [];

      for (const item of lineItems) {
        const linePayload = {
          product_code: item.productCode || item.salesCode || '',
          price: parseFloat(item.price) || 0,
          quantity: parseInt(item.quantity) || 0,
          category: item.productRange || ''
        };

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
          status: lineResponse.status,
          ok: lineResponse.ok,
          sent: linePayload,
          result: lineResult
        });
      }

      return res.status(200).json({
        success: true,
        jobId: result.id,
        jobNumber: result.job_number || result.reference,
        zigaflowResponse: result,
        lineItems: lineItemResults
      });
    }

    // Return the response for debugging
    return res.status(200).json({
      success: response.ok,
      zigaflowStatus: response.status,
      zigaflowResponse: result,
      sentPayload: jobPayload,
      note: !body.mainContactId ? 'Contact ID was missing - omitted from payload' : null
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
