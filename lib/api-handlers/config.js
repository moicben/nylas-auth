const { getPublicAccounts } = require("../nylas-credentials");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let accounts = [];
  try {
    accounts = await getPublicAccounts();
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to load Supabase accounts"
    });
  }
  if (!accounts.length) {
    return res.status(500).json({
      error: "No Nylas accounts found in Supabase table public.accounts"
    });
  }

  const firstClientId = accounts[0].clientId;
  const clientId = firstClientId;
  const inboxClientId = clientId;
  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";

  return res.status(200).json({
    clientId,
    inboxClientId,
    apiUrl,
    accounts
  });
};
