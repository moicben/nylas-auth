const { getQueryValue } = require("./request-query");
const { fetchSupabaseAccounts } = require("./supabase-accounts");

const MAX_INDEXED_ACCOUNTS = 20;
const CACHE_TTL_MS = 5000;

let cache = null;
let cacheExpiresAt = 0;
let inFlightPromise = null;

function getLegacyCredentials() {
  return null;
}

async function loadAccountsCached() {
  const now = Date.now();
  if (cache && now < cacheExpiresAt) {
    return cache;
  }

  if (!inFlightPromise) {
    inFlightPromise = fetchSupabaseAccounts()
      .then((accounts) => {
        cache = accounts;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return accounts;
      })
      .finally(() => {
        inFlightPromise = null;
      });
  }

  return inFlightPromise;
}

/**
 * Comptes chargés depuis Supabase public.accounts.
 */
async function listIndexedAccounts() {
  return loadAccountsCached();
}

async function isMultiAccountMode() {
  const accounts = await listIndexedAccounts();
  return accounts.length > 0;
}

/**
 * @returns {{ index: number, clientId: string }[]}
 */
async function getPublicAccounts() {
  const indexed = await listIndexedAccounts();
  return indexed.map(({ index, clientId }) => ({ index, clientId }));
}

/**
 * Résout clientId + apiKey pour un index de compte (>= 1).
 * @returns {{ clientId: string, apiKey: string, index: number } | { error: string }}
 */
async function resolveCredentials(accountIndex) {
  const n = Number.parseInt(String(accountIndex), 10);
  if (!Number.isFinite(n) || n < 1) {
    return { error: "Invalid account index" };
  }

  try {
    const indexed = await listIndexedAccounts();
    const found = indexed.find((a) => a.index === n);
    if (!found) {
      return { error: "Unknown account" };
    }
    return { clientId: found.clientId, apiKey: found.apiKey, index: n };
  } catch (error) {
    return {
      error: error?.message || "Unable to load Supabase accounts",
      status: 500
    };
  }
}

/**
 * Lit le query param account ; défaut 1. Utilisé par les handlers GET.
 * @returns {{ clientId: string, apiKey: string, accountIndex: number } | { error: string, status?: number }}
 */
async function resolveAccountFromQuery(req) {
  const raw = getQueryValue(req, "account");
  let accountIndex = 1;
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) {
      return { error: "Invalid account parameter", status: 400 };
    }
    accountIndex = n;
  }
  const creds = await resolveCredentials(accountIndex);
  if ("error" in creds) {
    return creds;
  }
  return {
    clientId: creds.clientId,
    apiKey: creds.apiKey,
    accountIndex: creds.index
  };
}

/**
 * @param {number | string | undefined} accountRaw — depuis body JSON
 */
async function resolveAccountFromBody(accountRaw) {
  let accountIndex = 1;
  if (accountRaw !== undefined && accountRaw !== null && accountRaw !== "") {
    const n = Number.parseInt(String(accountRaw), 10);
    if (!Number.isFinite(n) || n < 1) {
      return { error: "Invalid account parameter", status: 400 };
    }
    accountIndex = n;
  }
  return resolveCredentials(accountIndex);
}

module.exports = {
  MAX_INDEXED_ACCOUNTS,
  getLegacyCredentials,
  listIndexedAccounts,
  isMultiAccountMode,
  getPublicAccounts,
  resolveCredentials,
  resolveAccountFromQuery,
  resolveAccountFromBody
};
