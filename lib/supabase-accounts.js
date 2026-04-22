const SUPABASE_REST_PATH = "/rest/v1/accounts?select=id,client_id,api_key,grants_count,domain&order=id.asc";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getSupabaseAuthKey() {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRole && typeof serviceRole === "string" && serviceRole.trim()) {
    return serviceRole.trim();
  }
  const anon = process.env.SUPABASE_ANON_KEY;
  if (anon && typeof anon === "string" && anon.trim()) {
    return anon.trim();
  }
  throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");
}

function getSupabaseBaseUrl() {
  return getRequiredEnv("SUPABASE_URL").replace(/\/+$/, "");
}

function getSupabaseClientConfig() {
  return {
    baseUrl: getSupabaseBaseUrl(),
    authKey: getSupabaseAuthKey()
  };
}

function parseAccountId(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAccounts(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid Supabase accounts response: expected array");
  }

  const normalized = rows.map((row, idx) => {
    const accountId = parseAccountId(row?.id);
    const clientId = typeof row?.client_id === "string" ? row.client_id.trim() : "";
    const apiKey = typeof row?.api_key === "string" ? row.api_key.trim() : "";
    const grantsCount = Number.isFinite(Number(row?.grants_count))
      ? Math.max(0, Math.floor(Number(row.grants_count)))
      : 0;
    const domain = typeof row?.domain === "string" ? row.domain.trim() : "";
    if (!accountId || !clientId || !apiKey) {
      throw new Error("Invalid account row: id, client_id and api_key are required");
    }
    return {
      accountId,
      index: idx + 1,
      clientId,
      apiKey,
      grantsCount,
      domain: domain || null
    };
  });

  if (!normalized.length) {
    throw new Error("No accounts found in Supabase table public.accounts");
  }

  return normalized;
}

async function fetchSupabaseAccounts() {
  const { baseUrl, authKey } = getSupabaseClientConfig();

  const response = await fetch(`${baseUrl}${SUPABASE_REST_PATH}`, {
    headers: {
      apikey: authKey,
      Authorization: `Bearer ${authKey}`
    }
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Supabase accounts query failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }

  return normalizeAccounts(payload);
}

async function updateSupabaseGrantsCountByClientId({ clientId, grantsCount }) {
  const { baseUrl, authKey } = getSupabaseClientConfig();
  const safeCount = Number.isFinite(Number(grantsCount))
    ? Math.max(0, Math.floor(Number(grantsCount)))
    : 0;

  const response = await fetch(
    `${baseUrl}/rest/v1/accounts?client_id=eq.${encodeURIComponent(clientId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: authKey,
        Authorization: `Bearer ${authKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ grants_count: safeCount })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase grants_count update failed (${response.status}): ${text}`);
  }
}

module.exports = {
  getRequiredEnv,
  getSupabaseAuthKey,
  getSupabaseBaseUrl,
  getSupabaseClientConfig,
  fetchSupabaseAccounts,
  updateSupabaseGrantsCountByClientId
};
