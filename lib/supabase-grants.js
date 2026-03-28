const { getSupabaseClientConfig } = require("./supabase-accounts");

const GRANTS_SELECT =
  "id,account_id,grant_id,provider,email,display_name,grant_status,have_link,nylas_created_at,last_checked_at,synced_at,deleted_at";

function buildSupabaseHeaders(authKey, extra = {}) {
  return {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    ...extra
  };
}

async function parseSupabaseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function ensurePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function sanitizeText(value) {
  if (value === undefined || value === null) return null;
  const asString = String(value).trim();
  return asString ? asString : null;
}

function parseDateToIso(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    const maybeMs = asNumber > 1e11 ? asNumber : asNumber * 1000;
    const dateFromNumber = new Date(maybeMs);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber.toISOString();
  }
  const dateFromString = new Date(String(value));
  return Number.isNaN(dateFromString.getTime()) ? null : dateFromString.toISOString();
}

function normalizeGrantStatus(value) {
  return sanitizeText(value)?.toLowerCase() || "";
}

function resolveSoftDeleteStatus(value) {
  const status = normalizeGrantStatus(value);
  if (status === "valid") {
    return "deleted_on_nylas";
  }
  return status || "deleted_on_nylas";
}

function grantToUpsertRow(grant, accountId, syncedAtIso, checkedAtIso) {
  const grantId = sanitizeText(grant?.id || grant?.grantId);
  if (!grantId) return null;
  const provider = sanitizeText(grant?.provider);
  const email = sanitizeText(grant?.email);
  const displayName = sanitizeText(grant?.displayName || grant?.name || grantId);
  const grantStatus = sanitizeText(grant?.grantStatus || grant?.grant_status);
  const nylasCreatedAt = parseDateToIso(
    grant?.createdAt || grant?.created_at || grant?.created_at_ts || grant?.created
  );

  return {
    account_id: accountId,
    grant_id: grantId,
    provider,
    email,
    display_name: displayName,
    grant_status: grantStatus,
    nylas_created_at: nylasCreatedAt,
    last_checked_at: checkedAtIso,
    synced_at: syncedAtIso,
    deleted_at: null
  };
}

async function listSupabaseGrantsByAccountId(accountId, { includeDeleted = false } = {}) {
  const safeAccountId = ensurePositiveInt(accountId, "accountId");
  const { baseUrl, authKey } = getSupabaseClientConfig();
  const filters = [
    `select=${encodeURIComponent(GRANTS_SELECT)}`,
    `account_id=eq.${safeAccountId}`,
    "order=nylas_created_at.desc.nullslast,synced_at.desc.nullslast"
  ];
  if (!includeDeleted) {
    filters.push("deleted_at=is.null");
  }
  const response = await fetch(`${baseUrl}/rest/v1/grants?${filters.join("&")}`, {
    headers: buildSupabaseHeaders(authKey)
  });
  const payload = await parseSupabaseResponse(response);
  if (!response.ok) {
    throw new Error(
      `Supabase grants query failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }
  return Array.isArray(payload) ? payload : [];
}

async function upsertSupabaseGrants({ accountId, grants, checkedAt }) {
  const safeAccountId = ensurePositiveInt(accountId, "accountId");
  const rows = Array.isArray(grants) ? grants : [];
  const syncedAtIso = new Date().toISOString();
  const checkedAtIso = parseDateToIso(checkedAt) || syncedAtIso;
  const upsertRows = rows
    .map((grant) => grantToUpsertRow(grant, safeAccountId, syncedAtIso, checkedAtIso))
    .filter(Boolean);

  if (!upsertRows.length) {
    return { upserted: 0 };
  }

  const { baseUrl, authKey } = getSupabaseClientConfig();
  const response = await fetch(
    `${baseUrl}/rest/v1/grants?on_conflict=${encodeURIComponent("account_id,grant_id")}`,
    {
      method: "POST",
      headers: buildSupabaseHeaders(authKey, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(upsertRows)
    }
  );

  if (!response.ok) {
    const payload = await parseSupabaseResponse(response);
    throw new Error(
      `Supabase grants upsert failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }

  return { upserted: upsertRows.length };
}

async function softDeleteSupabaseGrant({ accountId, grantId, grantStatus = null }) {
  const safeAccountId = ensurePositiveInt(accountId, "accountId");
  const safeGrantId = sanitizeText(grantId);
  if (!safeGrantId) {
    throw new Error("grantId is required for soft delete");
  }
  const { baseUrl, authKey } = getSupabaseClientConfig();
  const nowIso = new Date().toISOString();
  const body = {
    deleted_at: nowIso,
    synced_at: nowIso,
    last_checked_at: nowIso
  };
  const normalizedStatus = resolveSoftDeleteStatus(grantStatus);
  if (normalizedStatus) {
    body.grant_status = normalizedStatus;
  }
  const response = await fetch(
    `${baseUrl}/rest/v1/grants?account_id=eq.${safeAccountId}&grant_id=eq.${encodeURIComponent(safeGrantId)}&deleted_at=is.null`,
    {
      method: "PATCH",
      headers: buildSupabaseHeaders(authKey, {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const payload = await parseSupabaseResponse(response);
    throw new Error(
      `Supabase grants soft delete failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }
  return { ok: true };
}

async function softDeleteMissingSupabaseGrants({ accountId, activeGrantIds }) {
  const safeAccountId = ensurePositiveInt(accountId, "accountId");
  const active = new Set(
    (Array.isArray(activeGrantIds) ? activeGrantIds : [])
      .map((value) => sanitizeText(value))
      .filter(Boolean)
  );
  const existingRows = await listSupabaseGrantsByAccountId(safeAccountId, {
    includeDeleted: false
  });
  const missingRows = existingRows.filter((row) => !active.has(sanitizeText(row?.grant_id)));
  for (const row of missingRows) {
    await softDeleteSupabaseGrant({
      accountId: safeAccountId,
      grantId: row?.grant_id,
      grantStatus: row?.grant_status || "missing_on_nylas_sync"
    });
  }
  return { softDeleted: missingRows.length };
}

function mapSupabaseGrantForApi(row) {
  const grantId = sanitizeText(row?.grant_id) || "";
  const status = sanitizeText(row?.grant_status) || "unknown";
  const email = sanitizeText(row?.email);
  const displayName = sanitizeText(row?.display_name) || email || grantId;
  return {
    id: grantId,
    provider: sanitizeText(row?.provider) || "unknown",
    email,
    grantStatus: status,
    displayName,
    createdAt: row?.nylas_created_at || row?.synced_at || null
  };
}

module.exports = {
  listSupabaseGrantsByAccountId,
  upsertSupabaseGrants,
  softDeleteSupabaseGrant,
  softDeleteMissingSupabaseGrants,
  mapSupabaseGrantForApi
};
