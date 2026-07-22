export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing required query param: id' });
  }

  const ZF_API_KEY = process.env.ZF_API_KEY;
  const ZF_BASE_URL = process.env.ZF_BASE_URL;

  if (!ZF_API_KEY || !ZF_BASE_URL) {
    return res.status(500).json({ error: 'Server misconfiguration: missing ZF env vars' });
  }

  try {
    const response = await fetch(
      `${ZF_BASE_URL}/jobs/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: {
          'X-Api-Key': ZF_API_KEY,
          'Accept': 'application/json'
        }
      }
    );

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
