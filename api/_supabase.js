function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL environment variable");
  }
  if (!anonKey) {
    throw new Error("Missing SUPABASE_ANON_KEY environment variable");
  }

  return { url, anonKey };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

async function upsertEmails(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const { url, anonKey } = getSupabaseConfig();
  const endpoint = `${url}/rest/v1/emails?on_conflict=grant_id,nylas_message_id`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        error: "Supabase upsert failed",
        status: response.status,
        details: payload
      })
    );
  }

  return Array.isArray(payload) ? payload : [];
}

module.exports = {
  upsertEmails
};
