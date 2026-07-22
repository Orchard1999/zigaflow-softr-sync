export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing required query param: id' });
  }

  const ZF_BASE = process.env.ZIGAFLOW_BASE_URL;
  const ZF_KEY  = process.env.ZIGAFLOW_API_KEY;

  if (!ZF_BASE || !ZF_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: missing Zigaflow env vars' });
  }

  try {
    const response = await fetch(`${ZF_BASE}/api/jobs/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        'X-Api-Key': ZF_KEY,
        'Accept': 'application/json',
        'Zigaflow-Api-Version': '2'
      }
    });

    const data = await response.json().catch(() => null);

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
