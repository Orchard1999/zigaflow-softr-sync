export default async function handler(req, res) {
  // Only GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing required query param: id' });
  }

  const apiKey = process.env.ZIGAFLOW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: no API key' });
  }

  try {
    const response = await fetch(`https://api.zigaflow.com/v1/jobs/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json().catch(() => null);

    // Pass through Zigaflow's status code and body
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Zigaflow API returned non-2xx',
        status: response.status,
        body: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to reach Zigaflow',
      message: err.message
    });
  }
}
