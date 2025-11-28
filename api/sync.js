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

    const clientsJson = await clientsRes.json();
    const clients = Array.isArray(clientsJson) ? clientsJson : clientsJson.data || [];

    //
    // 2. FETCH CONTACTS
    //
    const contactsRes = await fetch(`${process.env.ZIG_BASE_URL}/Contacts`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const contactsJson = await contactsRes.json();
    const contacts = Array.isArray(contactsJson) ? contactsJson : contactsJson.data || [];

    //
    // 3. Build Client Map
    //
    const clientMap = {};
    for (const c of clients) {
      clientMap[c.Name] = {
        zig_client_id: c.Id || "",
        price_list: c.PriceListName || c.PriceListId || ""
      };
    }

    //
    // 4. UPSERT CONTACTS INTO SOFTR
    //
    for (const c of contacts) {
      if (!c.Email) continue;

      const companyName = c.Customer;
      const companyData = clientMap[companyName] || {};

      const payload = {
        fields: {
          email: c.Email,
          first_name: c.FirstName || "",
          last_name: c.LastName || "",
          company_name: companyName || "",
          price_list: companyData.price_list || "",
          zig_contact_id: c.ContactId || "",
          zig_client_id: companyData.zig_client_id || ""
        }
      };

      //
      // CHECK IF USER EXISTS IN SOFTR
      //
      const existingRes = await fetch(
        `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records?filter=(email,eq,${encodeURIComponent(
          c.Email
        )})`,
        {
          headers: {
            Authorization: `Bearer ${process.env.SOFTR_API_KEY}`
          }
        }
      );

      const existing = await existingRes.json();

      //
      // UPDATE OR CREATE
      //
      if (existing?.records?.length > 0) {
        const recordId = existing.records[0].id;

        await fetch(
          `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records/${recordId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${process.env.SOFTR_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );
      } else {
        await fetch(
          `https://studio.softr.io/api/v1/datasets/hqfMbliV2UtsY2/records`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.SOFTR_API_KEY}`,
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
