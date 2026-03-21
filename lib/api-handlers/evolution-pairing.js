function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return "";

  // Normalize common trunk-zero pattern after country code (e.g. +62 081... => 6281..., +33 06... => 336...)
  const countryCodesWithTrunkZero = ["62", "33", "44", "49", "39", "34", "32", "31", "41", "61", "60", "81"];
  for (const cc of countryCodesWithTrunkZero) {
    if (digits.startsWith(`${cc}0`)) {
      return `${cc}${digits.slice(cc.length + 1)}`;
    }
  }

  return digits;
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

function randomAlphaSuffix(length = 4) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Nom strict: <numero>-<4 lettres>, ex: 33612345678-abcd */
function instanceNameFromPhone(fullPhone, suffix) {
  const digits = String(fullPhone || "").replace(/\D/g, "");
  const core = digits || "unknown";
  const safeSuffix = String(suffix || "").replace(/[^a-z]/g, "").slice(0, 4) || randomAlphaSuffix(4);
  const base = `${core}-${safeSuffix}`;
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

  console.info("[EVOLUTION_PAIRING] normalized_phone", {
    rawPhone: String(rawPhone || ""),
    fullPhone
  });

  let instanceName = instanceNameFromPhone(fullPhone, randomAlphaSuffix(4));

  try {
    let createResponse = null;
    let createPayload = {};
    const maxCreateAttempts = 5;
    for (let createAttempt = 1; createAttempt <= maxCreateAttempts; createAttempt += 1) {
      createResponse = await evolutionCreateInstance(
        evolutionApiUrl,
        evolutionApiKey,
        instanceName,
        fullPhone
      );
      createPayload = await createResponse.json().catch(() => ({}));

      if (createResponse.ok) {
        break;
      }
      if (!isLikelyDuplicateInstanceError(createResponse.status, createPayload)) {
        break;
      }
      instanceName = instanceNameFromPhone(fullPhone, randomAlphaSuffix(4));
    }

    if (!createResponse || !createResponse.ok) {
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

      console.info("[EVOLUTION_PAIRING] connect_attempt", {
        attempt,
        instanceName,
        status: connectResponse.status,
        count: typeof connectPayload?.count === "number" ? connectPayload.count : null,
        hasPairingCode: Boolean(typeof pairingCode === "string" && pairingCode.length > 0)
      });

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
