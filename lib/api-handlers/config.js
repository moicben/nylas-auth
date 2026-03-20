const { getPublicAccounts } = require("../nylas-credentials");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const accounts = getPublicAccounts();
  if (!accounts.length) {
    return res.status(500).json({
      error:
        "Missing Nylas credentials (NYLAS_CLIENT_ID_1 + NYLAS_API_KEY_1, or NYLAS_CLIENT_ID + NYLAS_API_KEY)"
    });
  }

  const firstClientId = accounts[0].clientId;
  const clientId = process.env.NYLAS_CLIENT_ID || firstClientId;
  const inboxClientId = process.env.INBOX_CLIENT_ID || clientId;
  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";

  return res.status(200).json({
    clientId,
    inboxClientId,
    apiUrl,
    accounts
  });
};
