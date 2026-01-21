// api/zigaflow/sync-pricelists.js
// Syncs price list names and IDs from Zigaflow to Softr

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ZIGAFLOW_API_KEY = process.env.ZIGAFLOW_API_KEY;
    const SOFTR_API_KEY = process.env.SOFTR_API_KEY;
    const SOFTR_DATABASE_ID = process.env.SOFTR_DATABASE_ID;
    const PRICELISTS_TABLE_ID = process.env.PRICELISTS_TABLE_ID; // You'll need to add this

    if (!ZIGAFLOW_API_KEY || !SOFTR_API_KEY || !SOFTR_DATABASE_ID) {
        return res.status(500).json({ error: 'Missing environment variables' });
    }

    try {
        // Step 1: Fetch all price lists from Zigaflow
        console.log('Fetching price lists from Zigaflow...');
        
        const zigaflowResponse = await fetch('https://api.zigaflow.com/v1/pricelist', {
            headers: {
                'Authorization': `Bearer ${ZIGAFLOW_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!zigaflowResponse.ok) {
            throw new Error(`Zigaflow API error: ${zigaflowResponse.status}`);
        }

        const zigaflowData = await zigaflowResponse.json();
        const priceLists = zigaflowData.data || [];

        console.log(`Found ${priceLists.length} price lists in Zigaflow`);

        // Step 2: Get existing price lists from Softr
        const softrResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${SOFTR_DATABASE_ID}/tables/${PRICELISTS_TABLE_ID}/records`,
            {
                headers: {
                    'Softr-Api-Key': SOFTR_API_KEY
                }
            }
        );

        let existingRecords = [];
        if (softrResponse.ok) {
            const softrData = await softrResponse.json();
            existingRecords = softrData.data?.records || [];
        }

        // Create lookup by Zigaflow ID
        const existingByZigaflowId = {};
        for (const record of existingRecords) {
            const zigaflowId = record.fields['Zigaflow ID'] || record.fields['zigaflow_id'];
            if (zigaflowId) {
                existingByZigaflowId[zigaflowId] = record.record_id;
            }
        }

        // Step 3: Sync to Softr
        const results = {
            created: 0,
            updated: 0,
            errors: []
        };

        for (const priceList of priceLists) {
            const zigaflowId = priceList.id;
            const name = priceList.name;
            const description = priceList.description || '';
            const currency = priceList.Currency?.value || 'GBP';

            const recordData = {
                'Zigaflow ID': zigaflowId,
                'Name': name,
                'Description': description,
                'Currency': currency
            };

            try {
                if (existingByZigaflowId[zigaflowId]) {
                    // Update existing record
                    const updateResponse = await fetch(
                        `https://tables-api.softr.io/api/v1/databases/${SOFTR_DATABASE_ID}/tables/${PRICELISTS_TABLE_ID}/records/${existingByZigaflowId[zigaflowId]}`,
                        {
                            method: 'PATCH',
                            headers: {
                                'Softr-Api-Key': SOFTR_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ fields: recordData })
                        }
                    );

                    if (updateResponse.ok) {
                        results.updated++;
                    } else {
                        results.errors.push(`Failed to update ${name}: ${updateResponse.status}`);
                    }
                } else {
                    // Create new record
                    const createResponse = await fetch(
                        `https://tables-api.softr.io/api/v1/databases/${SOFTR_DATABASE_ID}/tables/${PRICELISTS_TABLE_ID}/records`,
                        {
                            method: 'POST',
                            headers: {
                                'Softr-Api-Key': SOFTR_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ fields: recordData })
                        }
                    );

                    if (createResponse.ok) {
                        results.created++;
                    } else {
                        results.errors.push(`Failed to create ${name}: ${createResponse.status}`);
                    }
                }
            } catch (err) {
                results.errors.push(`Error syncing ${name}: ${err.message}`);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Synced ${priceLists.length} price lists`,
            results,
            priceLists: priceLists.map(pl => ({
                id: pl.id,
                name: pl.name,
                description: pl.description
            }))
        });

    } catch (error) {
        console.error('Sync error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
