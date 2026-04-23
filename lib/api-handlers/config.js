const { getCredentials } = require("../nylas-credentials");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { clientId, apiUrl } = getCredentials();
    return res.status(200).json({ clientId, apiUrl });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Config unavailable" });
  }
};
