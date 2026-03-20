const { resolveAccountFromQuery } = require("../nylas-credentials");

function buildNylasHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const resolved = resolveAccountFromQuery(req);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey } = resolved;

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";

  try {
    const listResponse = await fetch(`${apiUrl}/v3/grants?limit=100`, {
      headers: buildNylasHeaders(apiKey)
    });
    const listPayload = await parseJsonResponse(listResponse);

    if (!listResponse.ok) {
      return res.status(listResponse.status).json({
        ok: false,
        error: "Unable to list grants",
        details: listPayload
      });
    }

    const rawGrants = Array.isArray(listPayload?.data) ? listPayload.data : [];
    const candidates = rawGrants.filter((grant) => {
      const status = String(grant?.grant_status || "").toLowerCase();
      return status === "invalid" || status === "revoked";
    });

    const deleted = [];
    const failed = [];

    for (const grant of candidates) {
      const grantId = typeof grant?.id === "string" ? grant.id : "";
      if (!grantId) continue;

      try {
        const deleteResponse = await fetch(`${apiUrl}/v3/grants/${encodeURIComponent(grantId)}`, {
          method: "DELETE",
          headers: buildNylasHeaders(apiKey)
        });
        const deletePayload = await parseJsonResponse(deleteResponse);
        if (!deleteResponse.ok) {
          failed.push({
            id: grantId,
            status: grant?.grant_status || null,
            details: deletePayload
          });
          continue;
        }
        deleted.push({
          id: grantId,
          status: grant?.grant_status || null
        });
      } catch (error) {
        failed.push({
          id: grantId,
          status: grant?.grant_status || null,
          details: error?.message || "Delete request failed"
        });
      }
    }

    return res.status(200).json({
      ok: true,
      scanned: rawGrants.length,
      candidates: candidates.length,
      deleted,
      failed
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Unable to reach Nylas API",
      details: error?.message || "Unknown error"
    });
  }
};
