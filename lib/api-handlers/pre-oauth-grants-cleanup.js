const { listIndexedAccounts, resolveAccountFromQuery } = require("../nylas-credentials");
const { softDeleteSupabaseGrant } = require("../supabase-grants");
const { updateSupabaseGrantsCountByClientId } = require("../supabase-accounts");

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

function getJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return {};
    }
  }
  return {};
}

async function resolveApiKey(req, body) {
  try {
    const rawClientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    if (rawClientId) {
      const allAccounts = await listIndexedAccounts();
      const found = allAccounts.find((account) => account.clientId === rawClientId);
      if (found?.apiKey) {
        return { apiKey: found.apiKey, accountId: found.accountId, clientId: found.clientId };
      }
    }
    return resolveAccountFromQuery(req);
  } catch (error) {
    return {
      error: error?.message || "Unable to load Supabase accounts",
      status: 500
    };
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

function deriveDeletedGrantStatus(grant) {
  const reason = String(grant?.reason || "").toLowerCase();
  const status = String(grant?.grant_status || grant?.status || "").toLowerCase();
  if (reason === "messages_unauthorized" || reason === "messages_unusable") {
    return "unauthorized";
  }
  if (status === "invalid" || status === "revoked") {
    return status;
  }
  return "deleted_on_nylas";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = getJsonBody(req);
  const resolved = await resolveApiKey(req, body);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey, accountId, clientId } = resolved;

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

    const unauthorizedCandidates = [];
    const grantsToCheck = rawGrants.filter((grant) => !statusCandidateIds.has(grant?.id || ""));
    const minimalChecks = await Promise.all(
      grantsToCheck
        .filter((grant) => typeof grant?.id === "string" && grant.id)
        .map(async (grant) => {
          const grantId = grant.id;
          try {
            const checkResponse = await fetch(
              `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?limit=1`,
              {
                headers: buildNylasHeaders(apiKey)
              }
            );
            const checkPayload = await parseJsonResponse(checkResponse);
            const isUnauthorized = checkResponse.status === 401;
            const isUnusable = checkResponse.status === 400;
            if (isUnauthorized || isUnusable) {
              unauthorizedCandidates.push({
                id: grantId,
                status: grant?.grant_status || null,
                reason: isUnauthorized ? "messages_unauthorized" : "messages_unusable",
                details: checkPayload
              });
            }
            return {
              id: grantId,
              status: grant?.grant_status || null,
              ok: checkResponse.ok,
              httpStatus: checkResponse.status,
              unauthorized: isUnauthorized
            };
          } catch (error) {
            return {
              id: grantId,
              status: grant?.grant_status || null,
              ok: false,
              httpStatus: null,
              unauthorized: false,
              details: error?.message || "Minimal check failed"
            };
          }
        })
    );

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
        if (Number.isFinite(Number(accountId)) && accountId > 0) {
          try {
            await softDeleteSupabaseGrant({
              accountId,
              grantId,
              grantStatus: deriveDeletedGrantStatus(grant)
            });
          } catch (_syncError) {
            // Non bloquant: la suppression provider est deja appliquee.
          }
        }
      } catch (error) {
        failed.push({
          id: grantId,
          status: grant?.grant_status || null,
          reason: grant?.reason || "invalid_or_revoked_status",
          details: error?.message || "Delete request failed"
        });
      }
    }

    if (deleted.length && clientId) {
      const updatedCount = rawGrants.length - deleted.length;
      try {
        await updateSupabaseGrantsCountByClientId({
          clientId,
          grantsCount: Math.max(0, updatedCount)
        });
      } catch (_updateError) {
        // Non bloquant: le compteur sera resynce au prochain appel /api/config.
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
