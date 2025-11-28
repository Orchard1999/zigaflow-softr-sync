export default async function handler(req, res) {
  try {
    //
    // 1. FETCH CLIENTS
    //
    const clientsRes = await fetch(`${process.env.ZIG_BASE_URL}/Clients`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const clients = await clientsRes.json();

    //
    // 2. FETCH CLIENT TAGS
    //
    const tagsRes = await fetch(`${process.env.ZIG_BASE_URL}/ClientTags`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const tags = await tagsRes.json();

    // Map clientId → [tags]
    const clientTags = {};
    for (const tag of tags) {
      if (!clientTags[tag.ClientId]) clientTags[tag.ClientId] = [];
      clientTags[tag.ClientId].push(tag.Tag);
    }

    // Map clientName → { price_list, zig_client_id, tags }
    const clientMap = {};
    for (const c of clients) {
      clientMap[c.Name] = {
        zig_client_id: c.Id,
        price_list: c.PriceListName || c.PriceListId || "",
        tags: clientTags[c.Id] || []
      };
    }

    //
    // 3. FETCH CONTACTS
    //
    const contactsRes = await fetch(`${process.env.ZIG_BASE_URL}/Contacts`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const contacts = await contactsRes.json();

    //
    // 4. UPSERT INTO SOFTR USERS TABLE
    //
    for (const c of contacts) {
      if (!c.Email) continue;

      const company = c.Customer;
      const companyData = clientMap[company] || {};

      const payload = {
        fields: {
          email: c.Email,
          first_name: c.FirstName || "",
          last_name: c.LastName || "",
          company_name: company || "",
          price_list: companyData.price_list || "",
          tags: companyData.tags || [],
          zig_contact_id: c.ContactId,
          zig_client_id: companyData.zig_client_id || null
        }
      };

      // Check if user exists in Softr by email
      const existing = await fetch(
        `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records?filter=(email,eq,${encodeURIComponent(c.Email)})`,
        {
          headers: {
            "Authorization": `Bearer ${process.env.SOFTR_API_KEY}`
          }
        }
      ).then(r => r.json());

      if (existing?.records?.length > 0) {
        const recordId = existing.records[0].id;

        // Update existing record
        await fetch(
          `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records/${recordId}`,
          {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${process.env.SOFTR_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );
      } else {
        // Create new record
        await fetch(
          `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.SOFTR_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );
      }
    }

    res.status(200).json({ ok: true });

  } catch (error) {
    console.error("SYNC ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
