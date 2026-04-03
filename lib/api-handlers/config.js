const { listIndexedAccounts } = require("../nylas-credentials");

const MAX_AUTHENTICATED_GRANTS_FOR_PICK = 5;

function pickAuthAccount(accounts) {
  const belowThreshold = accounts
    .filter((a) => Number.isFinite(a.grantsCount))
    .filter((a) => a.grantsCount < MAX_AUTHENTICATED_GRANTS_FOR_PICK)
    .sort((a, b) => a.grantsCount - b.grantsCount || a.index - b.index);
  if (belowThreshold.length) return belowThreshold[0];

  const any = accounts
    .filter((a) => Number.isFinite(a.grantsCount))
    .sort((a, b) => a.grantsCount - b.grantsCount || a.index - b.index);
  if (any.length) return any[0];

  return accounts.slice().sort((a, b) => a.index - b.index)[0] || null;
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

  const accountStats = indexedAccounts.map((account) => ({
    index: account.index,
    clientId: account.clientId,
    grantsCount: Number.isFinite(Number(account.grantsCount))
      ? Number(account.grantsCount)
      : 0
  }));

  const selectedForAuth = pickAuthAccount(accountStats);
  if (!selectedForAuth?.clientId) {
    return res.status(500).json({
      error: "Unable to select a Nylas account for auth"
    });
  }

  const clientId = selectedForAuth.clientId;
  const accounts = accountStats.map(({ index, clientId: itemClientId, grantsCount }) => ({
    index,
    clientId: itemClientId,
    grantsCount
  }));

  return res.status(200).json({
    clientId,
    authAccountIndex: selectedForAuth.index,
    authAccountGrantsCount: selectedForAuth.grantsCount,
    inboxClientId: clientId,
    apiUrl,
    accounts
  });
};
