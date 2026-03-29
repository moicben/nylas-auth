const { getSupabaseClientConfig } = require("../supabase-accounts");

function buildSupabaseHeaders(authKey, extra = {}) {
  return {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    ...extra
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = (req.body?.grant_id || "").trim();
  const phone = (req.body?.phone || "").trim();

  if (!grantId) {
    return res.status(400).json({ error: "grant_id is required" });
  }
  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  const { baseUrl, authKey } = getSupabaseClientConfig();

  // Check if phone is already set for this grant
  const checkResponse = await fetch(
    `${baseUrl}/rest/v1/grants?grant_id=eq.${encodeURIComponent(grantId)}&deleted_at=is.null&select=phone`,
    { headers: buildSupabaseHeaders(authKey) }
  );

  if (!checkResponse.ok) {
    return res.status(500).json({ error: "Failed to check grant" });
  }

  const rows = await checkResponse.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(404).json({ error: "Grant not found" });
  }

  // If phone already set, don't overwrite
  if (rows[0].phone) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  // Update phone
  const updateResponse = await fetch(
    `${baseUrl}/rest/v1/grants?grant_id=eq.${encodeURIComponent(grantId)}&deleted_at=is.null`,
    {
      method: "PATCH",
      headers: buildSupabaseHeaders(authKey, {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({ phone })
    }
  );

  if (!updateResponse.ok) {
    return res.status(500).json({ error: "Failed to update phone" });
  }

  return res.status(200).json({ ok: true });
};
