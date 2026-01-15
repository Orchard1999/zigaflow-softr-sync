// /api/create-zigaflow-order.js
// VERSION 2 - Creates job header only (no line items yet)

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
      message: 'Zigaflow Create Order - v2 (job header only)',
      env_check: {
        has_zigaflow_key: !!process.env.ZIGAFLOW_API_KEY,
        has_zigaflow_url: !!process.env.ZIGAFLOW_BASE_URL
      },
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
    
    // Build the Zigaflow job payload
    const jobPayload = {
      client: {
        id: body.zigaflowClientId || '',
        value: body.customerName || ''
      },
      contact: {
        id: body.mainContactId || '',
        value: body.mainContactName || ''
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

    // Call Zigaflow API to create job
    const jobResponse = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZIGAFLOW_API_KEY}`
      },
      body: JSON.stringify(jobPayload)
    });

    // Get response as text first (in case it's not valid JSON)
    const responseText = await jobResponse.text();
    
    let jobResult;
    try {
      jobResult = JSON.parse(responseText);
    } catch (e) {
      jobResult = { rawResponse: responseText };
    }

    // Return everything for debugging
    return res.status(200).json({
      success: jobResponse.ok,
      zigaflowStatus: jobResponse.status,
      zigaflowResponse: jobResult,
      sentPayload: jobPayload,
      receivedFromMake: {
        customerName: body.customerName,
        zigaflowClientId: body.zigaflowClientId,
        lineItemCount: (body.lineItems || []).length
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
