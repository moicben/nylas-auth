const MAX_INDEXED_ACCOUNTS = 20;

function getLegacyCredentials() {
  const clientId = process.env.INBOX_CLIENT_ID || process.env.NYLAS_CLIENT_ID;
  const apiKey = process.env.INBOX_API_KEY || process.env.NYLAS_API_KEY;
  if (!clientId || typeof clientId !== "string" || !clientId.trim()) return null;
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) return null;
  return { clientId: clientId.trim(), apiKey: apiKey.trim(), index: 1 };
}

/**
 * Comptes NYLAS_CLIENT_ID_N + NYLAS_API_KEY_N (N >= 1), jusqu'à la première entrée manquante.
 */
function listIndexedAccounts() {
  const accounts = [];
  for (let i = 1; i <= MAX_INDEXED_ACCOUNTS; i += 1) {
    const clientId = process.env[`NYLAS_CLIENT_ID_${i}`];
    const apiKey = process.env[`NYLAS_API_KEY_${i}`];
    if (!clientId || typeof clientId !== "string" || !clientId.trim()) {
      break;
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      break;
    }
    accounts.push({
      index: i,
      clientId: clientId.trim(),
      apiKey: apiKey.trim()
    });
  }
  return accounts;
}

function isMultiAccountMode() {
  return listIndexedAccounts().length > 0;
}

/**
 * @returns {{ index: number, clientId: string }[]}
 */
function getPublicAccounts() {
  const indexed = listIndexedAccounts();
  if (indexed.length) {
    return indexed.map(({ index, clientId }) => ({ index, clientId }));
  }
  const legacy = getLegacyCredentials();
  if (!legacy) return [];
  return [{ index: 1, clientId: legacy.clientId }];
}

/**
 * Résout clientId + apiKey pour un index de compte (>= 1).
 * @returns {{ clientId: string, apiKey: string, index: number } | { error: string }}
 */
function resolveCredentials(accountIndex) {
  const indexed = listIndexedAccounts();
  const n = Number.parseInt(String(accountIndex), 10);
  if (!Number.isFinite(n) || n < 1) {
    return { error: "Invalid account index" };
  }

  if (indexed.length) {
    const found = indexed.find((a) => a.index === n);
    if (!found) {
      return { error: "Unknown account" };
    }
    return { clientId: found.clientId, apiKey: found.apiKey, index: n };
  }

  const legacy = getLegacyCredentials();
  if (!legacy) {
    return { error: "No Nylas credentials configured" };
  }
  if (n !== 1) {
    return { error: "Unknown account" };
  }
  return { clientId: legacy.clientId, apiKey: legacy.apiKey, index: 1 };
}

/**
 * Lit req.query.account ; défaut 1. Utilisé par les handlers GET.
 * @returns {{ clientId: string, apiKey: string, accountIndex: number } | { error: string, status?: number }}
 */
function resolveAccountFromQuery(req) {
  const raw = req.query && req.query.account;
  let accountIndex = 1;
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) {
      return { error: "Invalid account parameter", status: 400 };
    }
    accountIndex = n;
  }
  const creds = resolveCredentials(accountIndex);
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
function resolveAccountFromBody(accountRaw) {
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
