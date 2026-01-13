export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  return res.status(200).json({ 
    message: 'Endpoint is working!',
    method: req.method,
    timestamp: new Date().toISOString()
  });
}
```

**Commit this, wait 30 seconds, then test in browser:**
```
https://orchard-orders-api.vercel.app/api/create-zigaflow-order
