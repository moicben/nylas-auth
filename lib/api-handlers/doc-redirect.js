const { getQueryValue } = require("../request-query");
const { listIndexedAccounts } = require("../nylas-credentials");

const MAX_GRANTS_THRESHOLD = 5;
const ALLOWED_LANGS = new Set(["fr", "en", "qc"]);

function pickAccountWithDomain(accounts) {
  const withDomain = accounts.filter(
    (a) => typeof a.domain === "string" && a.domain.length > 0
  );
  if (!withDomain.length) return null;

  const belowThreshold = withDomain.filter(
    (a) => Number.isFinite(a.grantsCount) && a.grantsCount < MAX_GRANTS_THRESHOLD
  );
  const pool = belowThreshold.length ? belowThreshold : withDomain;

  const minGrants = Math.min(...pool.map((a) => a.grantsCount));
  const tied = pool.filter((a) => a.grantsCount === minGrants);
  return tied[Math.floor(Math.random() * tied.length)];
}

function sanitizeLang(raw) {
  const lang = String(raw || "").toLowerCase().trim();
  return ALLOWED_LANGS.has(lang) ? lang : "fr";
}

function sanitizePath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "/document-access";
  return value.startsWith("/") ? value : `/${value}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const lang = sanitizeLang(getQueryValue(req, "lang"));
  const targetPath = sanitizePath(getQueryValue(req, "path"));

  let accounts = [];
  try {
    accounts = await listIndexedAccounts();
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to load Supabase accounts"
    });
  }

  const selected = pickAccountWithDomain(accounts);
  if (!selected) {
    return res.status(500).json({
      error: "No account with a domain available"
    });
  }

  const location = `https://${selected.domain}${targetPath}?lang=${encodeURIComponent(lang)}`;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Location", location);
  return res.status(302).end();
};
