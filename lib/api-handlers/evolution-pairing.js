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

const INSTANCE_NAME_MAX = 80;

/** Nom lisible : wa-33612345678 ; si collision, wa-33612345678-m9abc */
function instanceNameFromPhone(fullPhone, uniquenessSalt) {
  const digits = String(fullPhone || "").replace(/\D/g, "");
  const core = digits || "unknown";
  const base = uniquenessSalt ? `wa-${core}-${uniquenessSalt}` : `wa-${core}`;
  return base.slice(0, INSTANCE_NAME_MAX).replace(/-+$/g, "");
}

function isLikelyDuplicateInstanceError(status, payload) {
  if (status === 409) return true;
  const blob = `${JSON.stringify(payload || {})} ${buildErrorMessage(payload, "")}`.toLowerCase();
  return /already exists|já existe|duplicat|duplicate|existiert|in use|already registered|instance name/i.test(
    blob
  );
}

async function evolutionCreateInstance(evolutionApiUrl, evolutionApiKey, instanceName, fullPhone) {
  return fetch(`${evolutionApiUrl}/instance/create`, {
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

  let instanceName = instanceNameFromPhone(fullPhone, "");
  let uniquenessSalt = "";

  try {
    let createResponse = await evolutionCreateInstance(
      evolutionApiUrl,
      evolutionApiKey,
      instanceName,
      fullPhone
    );
    let createPayload = await createResponse.json().catch(() => ({}));

    if (!createResponse.ok && isLikelyDuplicateInstanceError(createResponse.status, createPayload)) {
      uniquenessSalt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      instanceName = instanceNameFromPhone(fullPhone, uniquenessSalt);
      createResponse = await evolutionCreateInstance(
        evolutionApiUrl,
        evolutionApiKey,
        instanceName,
        fullPhone
      );
      createPayload = await createResponse.json().catch(() => ({}));
    }

    if (!createResponse.ok) {
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
          pairingCode,
          phoneDisplay: fullPhone
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
