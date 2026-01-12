export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  return res.status(200).json({
    success: true,
    message: 'Zigaflow order endpoint is working!',
    method: req.method
  });
}
```

Commit this, wait 30 seconds, then try:
```
https://orchard-orders-api.vercel.app/api/zigaflow/create-order
