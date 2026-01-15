// /api/create-zigaflow-order.js
// VERSION 3 - Testing different auth methods

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
      message: 'Zigaflow Create Order - v3 (auth test)',
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
    
    // Build a minimal test payload
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

    // Try METHOD 1: X-API-Key header (common for many APIs)
    const response1 = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ZIGAFLOW_API_KEY
      },
      body: JSON.stringify(jobPayload)
    });
    const result1Text = await response1.text();
    let result1;
    try { result1 = JSON.parse(result1Text); } catch(e) { result1 = result1Text; }

    // Try METHOD 2: api-key header (alternative)
    const response2 = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': ZIGAFLOW_API_KEY
      },
      body: JSON.stringify(jobPayload)
    });
    const result2Text = await response2.text();
    let result2;
    try { result2 = JSON.parse(result2Text); } catch(e) { result2 = result2Text; }

    // Try METHOD 3: apikey query parameter
    const response3 = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs?apikey=${ZIGAFLOW_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jobPayload)
    });
    const result3Text = await response3.text();
    let result3;
    try { result3 = JSON.parse(result3Text); } catch(e) { result3 = result3Text; }

    // Try METHOD 4: Bearer token (what we tried before)
    const response4 = await fetch(`${ZIGAFLOW_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZIGAFLOW_API_KEY}`
      },
      body: JSON.stringify(jobPayload)
    });
    const result4Text = await response4.text();
    let result4;
    try { result4 = JSON.parse(result4Text); } catch(e) { result4 = result4Text; }

    // Return all results
    return res.status(200).json({
      method1_xApiKey: { status: response1.status, result: result1 },
      method2_apiKey: { status: response2.status, result: result2 },
      method3_queryParam: { status: response3.status, result: result3 },
      method4_bearer: { status: response4.status, result: result4 },
      apiKeyPreview: ZIGAFLOW_API_KEY ? `${ZIGAFLOW_API_KEY.substring(0, 8)}...` : 'NOT SET'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
