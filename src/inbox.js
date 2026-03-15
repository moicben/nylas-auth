import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
const grantSelectEl = document.getElementById("grantSelect");
const readFilterEl = document.getElementById("readFilter");
const subjectSearchEl = document.getElementById("subjectSearch");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const refreshBtn = document.getElementById("refreshBtn");
const messagesListEl = document.getElementById("messagesList");
const readerPanelEl = document.getElementById("readerPanel");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const toolbarEl = document.querySelector(".toolbar");

const state = {
  sessionGrantId: "",
  selectedGrantId: "",
  mailbox: "INBOX",
  readFilter: "all",
  subject: "",
  messages: [],
  selectedMessageId: "",
  nextCursor: "",
  detailById: new Map(),
  isLoadingMessages: false,
  isDeletingMessage: false
};

let searchDebounce = null;

function createMailboxTabs() {
  if (!toolbarEl) return;
  const tabs = document.createElement("div");
  tabs.id = "mailboxTabs";
  tabs.setAttribute("role", "tablist");
  tabs.style.display = "inline-flex";
  tabs.style.gap = "6px";
  tabs.style.marginLeft = "8px";
  tabs.style.marginRight = "8px";

  const inboxBtn = document.createElement("button");
  inboxBtn.type = "button";
  inboxBtn.dataset.mailbox = "INBOX";
  inboxBtn.dataset.mailboxTab = "1";
  inboxBtn.textContent = "Inbox";

  const trashBtn = document.createElement("button");
  trashBtn.type = "button";
  trashBtn.dataset.mailbox = "TRASH";
  trashBtn.dataset.mailboxTab = "1";
  trashBtn.textContent = "Trash";

  const sentBtn = document.createElement("button");
  sentBtn.type = "button";
  sentBtn.dataset.mailbox = "SENT";
  sentBtn.dataset.mailboxTab = "1";
  sentBtn.textContent = "Sent";

  tabs.append(inboxBtn, sentBtn, trashBtn);
  toolbarEl.insertBefore(tabs, statusEl);
}

function renderMailboxTabs() {
  const buttons = document.querySelectorAll('button[data-mailbox-tab="1"]');
  buttons.forEach((button) => {
    const isActive = button.dataset.mailbox === state.mailbox;
    button.style.background = isActive ? "#1d4ed8" : "#1f2937";
    button.style.borderColor = isActive ? "#60a5fa" : "#374151";
    button.style.color = "#e5e7eb";
  });
}

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

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value || "");
  return textarea.value;
}

function normalizeBodyText(value) {
  return decodeHtmlEntities(value)
    .replace(/[\u2000-\u200f\u2028\u2029\u00ad]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeAndNormalizeEmailHtml(value) {
  if (!value) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(String(value), "text/html");

  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, base").forEach((node) => {
    node.remove();
  });

  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value || "";
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(val)) {
        node.removeAttribute(attr.name);
      }
    }
  });

  doc.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  return doc.body?.innerHTML || "";
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
      const counterpart = state.mailbox === "SENT"
        ? (Array.isArray(message.to) ? getAddress(message.to[0]) : "")
        : (Array.isArray(message.from) ? getAddress(message.from[0]) : "");
      const counterpartLabel = state.mailbox === "SENT" ? "A" : "De";
      const subject = message.subject || "(Sans sujet)";
      const date = formatDate(message.date || message.created_at);
      const active = message.id === state.selectedMessageId ? "active" : "";
      return `
        <button class="item ${active}" type="button" data-message-id="${escapeHtml(message.id)}">
          <p class="item-subject">${escapeHtml(subject)}</p>
          <p class="item-meta">${escapeHtml(counterpartLabel)}: ${escapeHtml(counterpart || "Inconnu")} ${date ? `- ${escapeHtml(date)}` : ""}</p>
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
  const htmlBody = sanitizeAndNormalizeEmailHtml(message?.bodyHtml || "");
  const fallbackText = normalizeBodyText(message?.bodyText || message?.snippet || "");
  const hasHtmlBody = Boolean(htmlBody.trim());
  const text = fallbackText || "(Aucun contenu lisible)";
  const deleteButtonLabel =
    state.mailbox === "TRASH" ? "Supprimer definitivement" : "Supprimer cet email";

  readerPanelEl.innerHTML = `
    <h2>${escapeHtml(subject)}</h2>
    <p>
      <button type="button" data-delete-message-id="${escapeHtml(message?.id || "")}">
        ${escapeHtml(deleteButtonLabel)}
      </button>
    </p>
    <p class="meta">
      De: ${escapeHtml(from || "Inconnu")}<br />
      A: ${escapeHtml(to || "Inconnu")}<br />
      Date: ${escapeHtml(date || "Inconnue")}
    </p>
    ${
      hasHtmlBody
        ? `<div class="email-body" style="line-height:1.45;word-break:break-word;">${htmlBody}</div>`
        : `<pre>${escapeHtml(text)}</pre>`
    }
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

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, init);
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

async function deleteMessage(messageId) {
  if (!messageId || !state.selectedGrantId || state.isDeletingMessage) return;

  const isTrash = state.mailbox === "TRASH";
  state.isDeletingMessage = true;
  setStatus(isTrash ? "Suppression definitive..." : "Deplacement dans la corbeille...");

  try {
    const params = new URLSearchParams();
    params.set("grantId", state.selectedGrantId);
    params.set("messageId", messageId);
    await fetchJson(`/api/message?${params.toString()}`, {
      method: isTrash ? "DELETE" : "PATCH"
    });

    state.detailById.delete(messageId);
    state.selectedMessageId = "";
    state.nextCursor = "";
    await loadMessages({ append: false });

    if (isTrash) {
      const stillExists = state.messages.some((message) => message.id === messageId);
      if (stillExists) {
        await fetchJson(`/api/message?${params.toString()}`, { method: "DELETE" });
        state.nextCursor = "";
        await loadMessages({ append: false });
      }

      const existsAfterRetry = state.messages.some((message) => message.id === messageId);
      if (existsAfterRetry) {
        setStatus(
          "Le provider n'a pas confirme la suppression definitive immediatement. Reessaye dans quelques secondes.",
          true
        );
        return;
      }
    }

    setStatus(isTrash ? "Email supprime definitivement" : "Email deplace dans la corbeille");
  } catch (error) {
    setStatus(error?.message || "Erreur lors de la suppression", true);
  } finally {
    state.isDeletingMessage = false;
  }
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
    params.set("limit", "200");
    params.set("mailbox", state.mailbox);
    params.set("read", state.readFilter);
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
    renderMessages();

    if (!append && state.messages.length) {
      state.selectedMessageId = state.messages[0].id;
      renderMessages();
      await loadMessageDetail(state.selectedMessageId);
    } else if (!state.messages.length) {
      state.selectedMessageId = "";
      renderReaderPlaceholder("Aucun email pour ce filtre.");
    }

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

  readFilterEl?.addEventListener("change", async () => {
    state.readFilter = readFilterEl.value || "all";
    state.nextCursor = "";
    state.selectedMessageId = "";
    state.detailById.clear();
    await loadMessages({ append: false });
  });

  toolbarEl?.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-mailbox-tab="1"]');
    if (!button) return;
    const mailbox = ["INBOX", "SENT", "TRASH"].includes(button.dataset.mailbox)
      ? button.dataset.mailbox
      : "INBOX";
    if (mailbox === state.mailbox) return;
    state.mailbox = mailbox;
    state.nextCursor = "";
    state.selectedMessageId = "";
    state.detailById.clear();
    renderMailboxTabs();
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

  refreshBtn?.addEventListener("click", async () => {
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

  readerPanelEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-delete-message-id]");
    if (!button) return;
    const messageId = button.dataset.deleteMessageId;
    if (!messageId) return;
    await deleteMessage(messageId);
  });
}

async function bootstrap() {
  try {
    setStatus("Initialisation...");
    createMailboxTabs();
    renderMailboxTabs();
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
