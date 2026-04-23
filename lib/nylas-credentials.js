function getCredentials() {
  const apiKey = process.env.NYLAS_API_KEY;
  const clientId = process.env.NYLAS_CLIENT_ID;
  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  if (!apiKey) throw new Error("Missing required environment variable: NYLAS_API_KEY");
  if (!clientId) throw new Error("Missing required environment variable: NYLAS_CLIENT_ID");
  return { apiKey, clientId, apiUrl };
}

function buildNylasHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

module.exports = {
  getCredentials,
  buildNylasHeaders
};
