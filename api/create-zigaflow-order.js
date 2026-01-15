// /api/create-zigaflow-order.js
// MINIMAL VERSION - just to test the endpoint works

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
      message: 'Endpoint is alive!',
      env_check: {
        has_zigaflow_key: !!process.env.ZIGAFLOW_API_KEY,
        has_zigaflow_url: !!process.env.ZIGAFLOW_BASE_URL,
        zigaflow_url: process.env.ZIGAFLOW_BASE_URL || 'NOT SET'
      },
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Just echo what we received
    const body = req.body || {};
    
    return res.status(200).json({
      success: true,
      message: 'POST received successfully',
      received: {
        customerName: body.customerName || 'not provided',
        zigaflowClientId: body.zigaflowClientId || 'not provided',
        lineItemCount: (body.lineItems || []).length
      },
      env_check: {
        has_zigaflow_key: !!process.env.ZIGAFLOW_API_KEY,
        has_zigaflow_url: !!process.env.ZIGAFLOW_BASE_URL
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
