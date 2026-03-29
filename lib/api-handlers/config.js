const { listIndexedAccounts } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");
const { scanNylasGrantsWithAuth } = require("../nylas-grants-metrics");
const { updateSupabaseGrantsCountByClientId } = require("../supabase-accounts");
const {
  upsertSupabaseGrants,
  softDeleteMissingSupabaseGrants,
  stampRevokedAt
} = require("../supabase-grants");

const MAX_AUTHENTICATED_GRANTS_FOR_PICK = 5;

function pickAuthAccount(accountStats) {
  const belowThreshold = accountStats
    .filter((item) => Number.isFinite(item.authenticatedValidGrantCount))
    .filter((item) => item.authenticatedValidGrantCount < MAX_AUTHENTICATED_GRANTS_FOR_PICK)
    .sort(
      (a, b) =>
        a.authenticatedValidGrantCount - b.authenticatedValidGrantCount || a.index - b.index
    );
  if (belowThreshold.length) return belowThreshold[0];

  const anyHealthy = accountStats
    .filter((item) => Number.isFinite(item.authenticatedValidGrantCount))
    .sort(
      (a, b) =>
        a.authenticatedValidGrantCount - b.authenticatedValidGrantCount || a.index - b.index
    );
  if (anyHealthy.length) return anyHealthy[0];

  return accountStats.slice().sort((a, b) => a.index - b.index)[0] || null;
}

function isSyncDisabled(req) {
  const raw = String(getQueryValue(req, "sync") || "").trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "off";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let indexedAccounts = [];
  try {
    indexedAccounts = await listIndexedAccounts();
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to load Supabase accounts"
    });
  }
  if (!indexedAccounts.length) {
    return res.status(500).json({
      error: "No Nylas accounts found in Supabase table public.accounts"
    });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const disableSync = isSyncDisabled(req);
  const requestedAccount = Number.parseInt(getQueryValue(req, "account"), 10);
  const hasRequestedAccount = Number.isFinite(requestedAccount) && requestedAccount >= 1;
  const accountStats = await Promise.all(
    indexedAccounts.map(async (account) => {
      if (disableSync) {
        return {
          index: account.index,
          clientId: account.clientId,
          authenticatedValidGrantCount: Number.isFinite(Number(account.grantsCount))
            ? Number(account.grantsCount)
            : Number.POSITIVE_INFINITY
        };
      }
      const shouldSyncThisAccount = !hasRequestedAccount || account.index === requestedAccount;
      if (!shouldSyncThisAccount) {
        return {
          index: account.index,
          clientId: account.clientId,
          authenticatedValidGrantCount: Number.isFinite(Number(account.grantsCount))
            ? Number(account.grantsCount)
            : Number.POSITIVE_INFINITY
        };
      }
      try {
        const metrics = await scanNylasGrantsWithAuth({
          apiUrl,
          apiKey: account.apiKey
        });
        const grantsCount = metrics.authenticatedValidGrantCount;
        if (Number.isFinite(Number(account.accountId)) && account.accountId > 0) {
          try {
            await upsertSupabaseGrants({
              accountId: account.accountId,
              grants: metrics.grants,
              checkedAt: metrics.checkedAt
            });
            await softDeleteMissingSupabaseGrants({
              accountId: account.accountId,
              activeGrantIds: metrics.grants.map((grant) => grant.id).filter(Boolean)
            });
            const revokedGrants = metrics.grants.filter(
              (g) => g.id && (!g.isValid || g.isAuthenticated === false)
            );
            for (const g of revokedGrants) {
              try {
                await stampRevokedAt({ grantId: g.id, revokedAt: metrics.checkedAt });
              } catch (_e) { /* non bloquant */ }
            }
          } catch (_syncError) {
            // Non bloquant: la selection auth continue meme si la sync grants echoue.
          }
        }
        try {
          await updateSupabaseGrantsCountByClientId({
            clientId: account.clientId,
            grantsCount
          });
        } catch (_updateError) {
          // Non bloquant: la selection auth continue meme si l'update Supabase echoue.
        }
        return {
          index: account.index,
          clientId: account.clientId,
          authenticatedValidGrantCount: grantsCount
        };
      } catch (_error) {
        return {
          index: account.index,
          clientId: account.clientId,
          authenticatedValidGrantCount: Number.POSITIVE_INFINITY
        };
      }
    })
  );

  const selectedForAuth = pickAuthAccount(accountStats);
  if (!selectedForAuth?.clientId) {
    return res.status(500).json({
      error: "Unable to select a Nylas account for auth"
    });
  }

  const clientId = selectedForAuth.clientId;
  const inboxClientId = clientId;
  const accounts = accountStats.map(({ index, clientId: itemClientId, authenticatedValidGrantCount }) => ({
    index,
    clientId: itemClientId,
    grantsCount: Number.isFinite(authenticatedValidGrantCount) ? authenticatedValidGrantCount : null
  }));

  return res.status(200).json({
    clientId,
    authAccountIndex: selectedForAuth.index,
    authAccountGrantsCount: Number.isFinite(selectedForAuth.authenticatedValidGrantCount)
      ? selectedForAuth.authenticatedValidGrantCount
      : null,
    inboxClientId,
    apiUrl,
    accounts
  });
};
