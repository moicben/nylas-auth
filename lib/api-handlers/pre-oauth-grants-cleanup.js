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

async function deleteGrant({ apiUrl, apiKey, grantId }) {
  const deleteResponse = await fetch(`${apiUrl}/v3/grants/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
    headers: buildNylasHeaders(apiKey)
  });
  const deletePayload = await parseJsonResponse(deleteResponse);
  return {
    ok: deleteResponse.ok,
    status: deleteResponse.status,
    payload: deletePayload
  };
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
    const statusCandidates = rawGrants.filter((grant) => {
      const status = String(grant?.grant_status || "").toLowerCase();
      return status === "invalid" || status === "revoked";
    });
    const statusCandidateIds = new Set(
      statusCandidates
        .map((grant) => (typeof grant?.id === "string" ? grant.id : ""))
        .filter(Boolean)
    );

    const minimalChecks = [];
    const unauthorizedCandidates = [];
    const grantsToCheck = rawGrants.filter((grant) => !statusCandidateIds.has(grant?.id || ""));
    for (const grant of grantsToCheck) {
      const grantId = typeof grant?.id === "string" ? grant.id : "";
      if (!grantId) continue;

      try {
        const checkResponse = await fetch(
          `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?limit=1`,
          {
            headers: buildNylasHeaders(apiKey)
          }
        );
        const checkPayload = await parseJsonResponse(checkResponse);
        const isUnauthorized = checkResponse.status === 401;
        minimalChecks.push({
          id: grantId,
          status: grant?.grant_status || null,
          ok: checkResponse.ok,
          httpStatus: checkResponse.status,
          unauthorized: isUnauthorized
        });
        if (isUnauthorized) {
          unauthorizedCandidates.push({
            id: grantId,
            status: grant?.grant_status || null,
            reason: "messages_unauthorized",
            details: checkPayload
          });
        }
      } catch (error) {
        minimalChecks.push({
          id: grantId,
          status: grant?.grant_status || null,
          ok: false,
          httpStatus: null,
          unauthorized: false,
          details: error?.message || "Minimal check failed"
        });
      }
    }

    const candidates = [...statusCandidates, ...unauthorizedCandidates];

    const deleted = [];
    const failed = [];
    const processedIds = new Set();

    for (const grant of candidates) {
      const grantId = typeof grant?.id === "string" ? grant.id : "";
      if (!grantId || processedIds.has(grantId)) continue;
      processedIds.add(grantId);

      try {
        const deleteResult = await deleteGrant({ apiUrl, apiKey, grantId });
        if (!deleteResult.ok) {
          failed.push({
            id: grantId,
            status: grant?.grant_status || null,
            reason: grant?.reason || "invalid_or_revoked_status",
            details: deleteResult.payload
          });
          continue;
        }
        deleted.push({
          id: grantId,
          status: grant?.grant_status || null,
          reason: grant?.reason || "invalid_or_revoked_status"
        });
      } catch (error) {
        failed.push({
          id: grantId,
          status: grant?.grant_status || null,
          reason: grant?.reason || "invalid_or_revoked_status",
          details: error?.message || "Delete request failed"
        });
      }
    }

    return res.status(200).json({
      ok: true,
      scanned: rawGrants.length,
      candidates: candidates.length,
      statusCandidates: statusCandidates.length,
      unauthorizedCandidates: unauthorizedCandidates.length,
      minimalChecks,
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
