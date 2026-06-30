// Create a new order
export default async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const orderData = req.body;
        // Get table schema
        const schemaResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/67HNjrAhYDgbOD`,
            {
                headers: {
                    'Softr-Api-Key': process.env.SOFTR_API_KEY
                }
            }
        );
        if (!schemaResponse.ok) {
            throw new Error('Failed to fetch table schema');
        }
        const schemaData = await schemaResponse.json();
        const fields = schemaData.data.fields || [];
        
        const mapping = {};
        fields.forEach(field => {
            mapping[field.name] = field.id;
        });
        // Map friendly field names to field IDs
        const mappedData = {};
        Object.entries(orderData).forEach(([key, value]) => {
            if (mapping[key]) {
                mappedData[mapping[key]] = value;
            }
        });
        // Create order
        const createResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/67HNjrAhYDgbOD/records`,
            {
                method: 'POST',
                headers: {
                    'Softr-Api-Key': process.env.SOFTR_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fields: mappedData })
            }
        );
        if (!createResponse.ok) {
            const errorText = await createResponse.text();
            throw new Error('Failed to create order: ' + errorText);
        }
        const result = await createResponse.json();
        const orderId = result.data.id;
        // Fetch the created order to get Order Number
        const fetchOrderResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/67HNjrAhYDgbOD/records/${orderId}`,
            {
                headers: {
                    'Softr-Api-Key': process.env.SOFTR_API_KEY
                }
            }
        );
        let orderNumber = orderId;
        if (fetchOrderResponse.ok) {
            const fetchedOrder = await fetchOrderResponse.json();
            const orderNumberFieldId = mapping['Order Number'];
            if (orderNumberFieldId && fetchedOrder.data.fields[orderNumberFieldId]) {
                orderNumber = fetchedOrder.data.fields[orderNumberFieldId];
            }
        }
        res.status(201).json({
            success: true,
            orderId: orderId,
            orderNumber: orderNumber
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
}
