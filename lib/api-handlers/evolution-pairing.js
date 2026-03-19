function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePhone(rawPhone) {
  return String(rawPhone || "").replace(/\D/g, "");
}

function buildErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const fromArray = payload?.response?.message?.[0];
  if (typeof fromArray === "string" && fromArray.length > 0) return fromArray;
  if (typeof payload.message === "string" && payload.message.length > 0) return payload.message;
  if (typeof payload.error === "string" && payload.error.length > 0) return payload.error;
  return fallback;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const evolutionApiUrl = process.env.EVOLUTION_API_URL || "https://vps.smart-solutions-n8n.com";
  const evolutionApiKey = process.env.EVOLUTION_API_KEY;

  if (!evolutionApiKey) {
    return res.status(500).json({ error: "Missing EVOLUTION_API_KEY environment variable" });
  }

  const rawPhone = req.body?.phone;
  const fullPhone = sanitizePhone(rawPhone);

  if (!fullPhone) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  const instanceName = `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    const createResponse = await fetch(`${evolutionApiUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionApiKey
      },
      body: JSON.stringify({
        instanceName,
        number: fullPhone,
        integration: "WHATSAPP-BAILEYS",
        qrcode: false
      })
    });

    if (!createResponse.ok) {
      const createPayload = await createResponse.json().catch(() => ({}));
      return res.status(createResponse.status).json({
        error: buildErrorMessage(createPayload, "Failed to create Evolution instance")
      });
    }

    const maxAttempts = 12;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const connectResponse = await fetch(
        `${evolutionApiUrl}/instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(fullPhone)}`,
        {
          method: "GET",
          headers: { apikey: evolutionApiKey }
        }
      );

      const connectPayload = await connectResponse.json().catch(() => ({}));
      const pairingCode = connectPayload?.pairingCode || connectPayload?.pairing_code || "";

      if (connectResponse.ok && typeof pairingCode === "string" && pairingCode.length > 0) {
        return res.status(200).json({
          instanceName,
          pairingCode
        });
      }

      await sleep(1400);
    }

    return res.status(504).json({
      error: "No pairing code received from Evolution API, please retry"
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Evolution pairing flow failed"
    });
  }
};
