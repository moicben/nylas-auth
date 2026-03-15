import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
const grantSelectEl = document.getElementById("grantSelect");
const subjectSearchEl = document.getElementById("subjectSearch");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const messagesListEl = document.getElementById("messagesList");
const readerPanelEl = document.getElementById("readerPanel");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const state = {
  sessionGrantId: "",
  selectedGrantId: "",
  subject: "",
  messages: [],
  selectedMessageId: "",
  nextCursor: "",
  detailById: new Map(),
  isLoadingMessages: false
};

let searchDebounce = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#f87171" : "#9ca3af";
}

function getAddress(entry) {
  if (!entry || typeof entry !== "object") return "";
  return entry.email || entry.name || "";
}

function formatDate(value) {
  if (!value) return "";
  const numberValue = Number(value);
  const date = Number.isFinite(numberValue)
    ? new Date(numberValue * 1000)
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderReaderPlaceholder(text) {
  readerPanelEl.innerHTML = `<p class="empty">${escapeHtml(text)}</p>`;
}

function renderMessages() {
  if (!state.messages.length) {
    messagesListEl.innerHTML = '<p class="empty">Aucun email pour ce filtre.</p>';
    return;
  }

  messagesListEl.innerHTML = state.messages
    .map((message) => {
      const from = Array.isArray(message.from) ? getAddress(message.from[0]) : "";
      const subject = message.subject || "(Sans sujet)";
      const date = formatDate(message.date || message.created_at);
      const active = message.id === state.selectedMessageId ? "active" : "";
      return `
        <button class="item ${active}" type="button" data-message-id="${escapeHtml(message.id)}">
          <p class="item-subject">${escapeHtml(subject)}</p>
          <p class="item-meta">${escapeHtml(from)} ${date ? `- ${escapeHtml(date)}` : ""}</p>
        </button>
      `;
    })
    .join("");
}

function renderReader(message) {
  const subject = message?.subject || "(Sans sujet)";
  const from = Array.isArray(message?.from) ? getAddress(message.from[0]) : "";
  const to = Array.isArray(message?.to) ? getAddress(message.to[0]) : "";
  const date = formatDate(message?.date);
  const text = message?.bodyText || message?.snippet || "(Aucun contenu lisible)";

  readerPanelEl.innerHTML = `
    <h2>${escapeHtml(subject)}</h2>
    <p class="meta">
      De: ${escapeHtml(from || "Inconnu")}<br />
      A: ${escapeHtml(to || "Inconnu")}<br />
      Date: ${escapeHtml(date || "Inconnue")}
    </p>
    <pre>${escapeHtml(text)}</pre>
  `;
}

function updateLoadMoreButton() {
  const hasCursor = Boolean(state.nextCursor);
  loadMoreBtn.hidden = !hasCursor || state.isLoadingMessages;
}

async function loadRuntimeConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "Impossible de charger la config runtime");
  }
  return data;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.details?.error || "Erreur API");
  }
  return data;
}

async function loadGrants() {
  const payload = await fetchJson("/api/grants");
  const grants = Array.isArray(payload?.data) ? payload.data : [];
  grantSelectEl.innerHTML = "";

  if (!grants.length) {
    setStatus("Aucun grant actif trouvé", true);
    renderReaderPlaceholder("Aucun grant actif.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant actif.</p>';
    return;
  }

  for (const grant of grants) {
    const option = document.createElement("option");
    option.value = grant.id;
    option.textContent = `${grant.displayName || grant.id} (${grant.provider || "provider"})`;
    grantSelectEl.append(option);
  }

  const preferred = grants.find((grant) => grant.id === state.sessionGrantId)?.id;
  state.selectedGrantId = preferred || grants[0].id;
  grantSelectEl.value = state.selectedGrantId;
}

function getNextCursor(payload) {
  return (
    payload?.next_cursor ||
    payload?.nextCursor ||
    payload?.next_page_token ||
    payload?.nextPageToken ||
    ""
  );
}

async function loadMessages({ append = false } = {}) {
  if (!state.selectedGrantId) {
    return;
  }

  state.isLoadingMessages = true;
  updateLoadMoreButton();
  setStatus("Chargement des emails...");

  try {
    const params = new URLSearchParams();
    params.set("grantId", state.selectedGrantId);
    params.set("limit", "20");
    if (state.subject) {
      params.set("subject", state.subject);
    }
    if (append && state.nextCursor) {
      params.set("cursor", state.nextCursor);
    }

    const payload = await fetchJson(`/api/messages?${params.toString()}`);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    state.messages = append ? state.messages.concat(data) : data;
    state.nextCursor = getNextCursor(payload);

    if (!append && state.messages.length) {
      state.selectedMessageId = state.messages[0].id;
      await loadMessageDetail(state.selectedMessageId);
    } else if (!state.messages.length) {
      state.selectedMessageId = "";
      renderReaderPlaceholder("Aucun email pour ce filtre.");
    }

    renderMessages();
    setStatus(`${state.messages.length} email(s) chargés`);
  } catch (error) {
    setStatus(error?.message || "Erreur lors du chargement des emails", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible de charger les emails.</p>';
    renderReaderPlaceholder("Impossible de charger le contenu.");
  } finally {
    state.isLoadingMessages = false;
    updateLoadMoreButton();
  }
}

async function loadMessageDetail(messageId) {
  if (!messageId || !state.selectedGrantId) return;

  if (state.detailById.has(messageId)) {
    renderReader(state.detailById.get(messageId));
    return;
  }

  renderReaderPlaceholder("Chargement du contenu...");
  try {
    const params = new URLSearchParams();
    params.set("grantId", state.selectedGrantId);
    params.set("messageId", messageId);
    const payload = await fetchJson(`/api/message?${params.toString()}`);
    const detail = payload?.data || null;
    if (!detail) {
      throw new Error("Aucun détail trouvé");
    }
    state.detailById.set(messageId, detail);
    renderReader(detail);
  } catch (error) {
    renderReaderPlaceholder(error?.message || "Erreur de lecture du message.");
  }
}

function setupEvents() {
  grantSelectEl.addEventListener("change", async () => {
    state.selectedGrantId = grantSelectEl.value;
    state.detailById.clear();
    state.nextCursor = "";
    await loadMessages({ append: false });
  });

  subjectSearchEl.addEventListener("input", () => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }
    searchDebounce = setTimeout(async () => {
      state.subject = subjectSearchEl.value.trim();
      state.nextCursor = "";
      state.detailById.clear();
      await loadMessages({ append: false });
    }, 300);
  });

  clearSearchBtn.addEventListener("click", async () => {
    if (!subjectSearchEl.value) return;
    subjectSearchEl.value = "";
    state.subject = "";
    state.nextCursor = "";
    state.detailById.clear();
    await loadMessages({ append: false });
  });

  loadMoreBtn.addEventListener("click", async () => {
    await loadMessages({ append: true });
  });

  messagesListEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-message-id]");
    if (!button) return;
    const messageId = button.dataset.messageId;
    if (!messageId) return;
    state.selectedMessageId = messageId;
    renderMessages();
    await loadMessageDetail(messageId);
  });
}

async function bootstrap() {
  try {
    setStatus("Initialisation...");
    const cfg = await loadRuntimeConfig();
    const connect = new NylasConnect({
      clientId: cfg.clientId,
      redirectUri: `${window.location.origin}/auth/callback`,
      apiUrl: cfg.apiUrl || "https://api.eu.nylas.com",
      environment: "development",
      persistTokens: true
    });

    const session = await connect.getSession();
    state.sessionGrantId = session?.grantId || "";

    setupEvents();
    await loadGrants();
    await loadMessages({ append: false });
  } catch (error) {
    setStatus(error?.message || "Erreur d'initialisation", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible d’initialiser Inbox.</p>';
    renderReaderPlaceholder("Vérifie ta session OAuth puis réessaye.");
  }
}

await bootstrap();
