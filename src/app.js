import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
const sessionOutput = document.getElementById("sessionOutput");
const apiOutput = document.getElementById("apiOutput");
const connectBtn = document.getElementById("connectBtn");
const debugBtn = document.getElementById("debugBtn");
const logoutBtn = document.getElementById("logoutBtn");
const checkBtn = document.getElementById("checkBtn");
const testApiBtn = document.getElementById("testApiBtn");

let nylasConnect = null;

function setStatus(message, ok = true) {
  statusEl.textContent = `Etat: ${message}`;
  statusEl.className = ok ? "ok" : "err";
}

function pretty(data) {
  return JSON.stringify(data, null, 2);
}

function resolveOAuthUrl(connectResult) {
  if (typeof connectResult === "string") return connectResult;
  if (connectResult && typeof connectResult === "object") {
    const maybeUrl = connectResult.url || connectResult.redirectUrl || connectResult.authorizationUrl;
    if (typeof maybeUrl === "string") return maybeUrl;
  }
  throw new Error("URL OAuth invalide renvoyée par Nylas Connect");
}

async function handleCallbackIfNeeded() {
  const qs = new URLSearchParams(window.location.search);
  const hasOAuthParams = qs.has("code") || qs.has("state") || qs.has("error");
  if (!hasOAuthParams) return;

  try {
    setStatus("traitement du callback OAuth...");
    const result = await nylasConnect.callback();
    setStatus("authentification réussie");
    sessionOutput.textContent = pretty(result);

    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  } catch (error) {
    setStatus("callback OAuth en erreur", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
}

async function refreshSession() {
  try {
    const status = await nylasConnect.getConnectionStatus();
    const session = await nylasConnect.getSession();
    setStatus(`statut connexion: ${status}`);
    sessionOutput.textContent = pretty({ status, session });
  } catch (error) {
    setStatus("impossible de récupérer la session", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
}

connectBtn.addEventListener("click", async () => {
  if (!nylasConnect) {
    setStatus("config Nylas non chargée", false);
    return;
  }

  try {
    setStatus("connexion en cours...");
    sessionStorage.setItem("oauth_origin", "auth-test");
    const connectResult = await nylasConnect.connect({
      method: "inline",
      provider: "google"
    });
    const url = resolveOAuthUrl(connectResult);
    setStatus("redirection vers Google...");
    window.location.href = url;
  } catch (error) {
    setStatus("échec connexion OAuth", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
});

debugBtn.addEventListener("click", async () => {
  if (!nylasConnect) {
    setStatus("config Nylas non chargée", false);
    return;
  }

  try {
    // Inline returns the URL so we can inspect exact query params sent to Nylas.
    const connectResult = await nylasConnect.connect({
      method: "inline",
      provider: "google"
    });
    const url = resolveOAuthUrl(connectResult);
    const u = new URL(url);
    sessionOutput.textContent = pretty({
      generatedOAuthUrl: url,
      host: u.host,
      pathname: u.pathname,
      redirect_uri: u.searchParams.get("redirect_uri"),
      client_id: u.searchParams.get("client_id")
    });
    setStatus("URL OAuth générée (debug)");
  } catch (error) {
    setStatus("échec debug OAuth URL", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!nylasConnect) {
    setStatus("config Nylas non chargée", false);
    return;
  }

  try {
    await nylasConnect.logout();
    setStatus("session déconnectée");
    sessionOutput.textContent = "-";
  } catch (error) {
    setStatus("échec déconnexion", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
});

checkBtn.addEventListener("click", refreshSession);

testApiBtn.addEventListener("click", async () => {
  if (!nylasConnect) {
    setStatus("config Nylas non chargée", false);
    return;
  }

  const session = await nylasConnect.getSession();
  const grantId = session?.grantId;
  if (!grantId) {
    apiOutput.textContent = "Aucun grantId en session. Connecte d'abord Gmail.";
    return;
  }

  try {
    const response = await fetch(`/api/messages?grantId=${encodeURIComponent(grantId)}&limit=5`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(pretty(data));
    }
    apiOutput.textContent = pretty(data);
  } catch (error) {
    apiOutput.textContent = pretty({
      message: error?.message || "Erreur API inconnue",
      name: error?.name
    });
  }
});

async function loadRuntimeConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "Impossible de charger la config runtime");
  }
  return data;
}

async function bootstrap() {
  try {
    setStatus("chargement de la configuration...");
    const cfg = await loadRuntimeConfig();

    nylasConnect = new NylasConnect({
      clientId: cfg.clientId,
      redirectUri: `${window.location.origin}/auth/callback`,
      apiUrl: cfg.apiUrl || "https://api.eu.nylas.com",
      environment: "development",
      persistTokens: true,
      debug: true,
      logLevel: "info"
    });

    setStatus("prêt");
    await handleCallbackIfNeeded();
    await refreshSession();
  } catch (error) {
    setStatus("impossible de charger la configuration", false);
    sessionOutput.textContent = pretty({
      message: error?.message || "Erreur inconnue",
      name: error?.name
    });
  }
}

await bootstrap();
