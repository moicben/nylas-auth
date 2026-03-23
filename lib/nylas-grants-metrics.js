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

function isValidGrantStatus(grant) {
  return String(grant?.grant_status || "").toLowerCase() === "valid";
}

async function isGrantStillAuthenticated({ apiUrl, apiKey, grantId }) {
  const response = await fetch(
    `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?limit=1`,
    {
      headers: buildNylasHeaders(apiKey)
    }
  );
  if (response.status === 401) return false;
  return response.ok;
}

async function countAuthenticatedValidGrants({ apiUrl, apiKey }) {
  const listResponse = await fetch(`${apiUrl}/v3/grants?limit=100`, {
    headers: buildNylasHeaders(apiKey)
  });
  const listPayload = await parseJsonResponse(listResponse);
  if (!listResponse.ok) {
    throw new Error(
      `Unable to list grants (${listResponse.status}): ${JSON.stringify(listPayload)}`
    );
  }

  const rawGrants = Array.isArray(listPayload?.data) ? listPayload.data : [];
  const validGrants = rawGrants.filter((grant) => isValidGrantStatus(grant));
  let authenticatedValidGrantCount = 0;

  for (const grant of validGrants) {
    const grantId = typeof grant?.id === "string" ? grant.id : "";
    if (!grantId) continue;
    try {
      const authenticated = await isGrantStillAuthenticated({
        apiUrl,
        apiKey,
        grantId
      });
      if (authenticated) {
        authenticatedValidGrantCount += 1;
      }
    } catch (_error) {
      // Ignore transient check failures to avoid counting phantom grants.
    }
  }

  return {
    authenticatedValidGrantCount,
    totalGrants: rawGrants.length,
    validGrants: validGrants.length
  };
}

module.exports = {
  countAuthenticatedValidGrants
};
