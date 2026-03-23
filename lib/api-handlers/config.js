const { listIndexedAccounts } = require("../nylas-credentials");
const { countAuthenticatedValidGrants } = require("../nylas-grants-metrics");
const { updateSupabaseGrantsCountByClientId } = require("../supabase-accounts");

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
  const accountStats = await Promise.all(
    indexedAccounts.map(async (account) => {
      try {
        const metrics = await countAuthenticatedValidGrants({
          apiUrl,
          apiKey: account.apiKey
        });
        const grantsCount = metrics.authenticatedValidGrantCount;
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
