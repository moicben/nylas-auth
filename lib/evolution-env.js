const { getQueryValue } = require("./request-query");

function evolutionApiConfig() {
  const base = String(process.env.EVOLUTION_API_URL || "")
    .trim()
    .replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  return { base, apiKey };
}

function evolutionJsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

/** @returns {{ base: string, apiKey: string } | null} */
function requireEvolutionCredentials(res) {
  const { base, apiKey } = evolutionApiConfig();
  if (!apiKey) {
    evolutionJsonError(res, 500, "Missing EVOLUTION_API_KEY environment variable");
    return null;
  }
  if (!base) {
    evolutionJsonError(res, 500, "Missing EVOLUTION_API_URL environment variable");
    return null;
  }
  return { base, apiKey };
}

function queryInstanceName(req) {
  return getQueryValue(req, "instance").trim();
}

module.exports = {
  evolutionApiConfig,
  requireEvolutionCredentials,
  queryInstanceName
};
