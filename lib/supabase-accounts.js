const SUPABASE_REST_PATH = "/rest/v1/accounts?select=id,client_id,api_key&order=id.asc";

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

function normalizeAccounts(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid Supabase accounts response: expected array");
  }

  const normalized = rows.map((row, idx) => {
    const clientId = typeof row?.client_id === "string" ? row.client_id.trim() : "";
    const apiKey = typeof row?.api_key === "string" ? row.api_key.trim() : "";
    if (!clientId || !apiKey) {
      throw new Error("Invalid account row: client_id and api_key are required");
    }
    return {
      index: idx + 1,
      clientId,
      apiKey
    };
  });

  if (!normalized.length) {
    throw new Error("No accounts found in Supabase table public.accounts");
  }

  return normalized;
}

async function fetchSupabaseAccounts() {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const supabaseAuthKey = getSupabaseAuthKey();

  const response = await fetch(`${supabaseUrl}${SUPABASE_REST_PATH}`, {
    headers: {
      apikey: supabaseAuthKey,
      Authorization: `Bearer ${supabaseAuthKey}`
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

module.exports = {
  fetchSupabaseAccounts
};
