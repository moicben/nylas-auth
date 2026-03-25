import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
const accountSelectEl = document.getElementById("accountSelect");
const grantSelectEl = document.getElementById("grantSelect");
const deleteGrantBtn = document.getElementById("deleteGrantBtn");
const readFilterEl = document.getElementById("readFilter");
const subjectSearchInputEl = document.getElementById("subjectSearchInput");
const subjectSearchBtnEl = document.getElementById("subjectSearchBtn");
const refreshBtn = document.getElementById("refreshBtn");
const messagesListEl = document.getElementById("messagesList");
const readerPanelEl = document.getElementById("readerPanel");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const toolbarEl = document.querySelector(".toolbar");
const waInstanceLabelEl = document.getElementById("waInstanceLabel");
const waInstanceSelectEl = document.getElementById("waInstanceSelect");

const state = {
  source: "email",
  sessionGrantId: "",
  selectedGrantId: "__ALL__",
  selectedGrantAccountIndex: 0,
  mailbox: "INBOX",
  readFilter: "all",
  subjectQuery: "",
  messages: [],
  selectedMessageId: "",
  selectedMessageKey: "",
  nextCursor: "",
  detailById: new Map(),
  messageScopeById: new Map(),
  grantsByAccount: new Map(),
  allGrantRefs: [],
  emailLoadSeq: 0,
  isLoadingMessages: false,
  isDeletingMessage: false,
  isDeletingGrant: false,
  /** WhatsApp (Evolution) — instance choisie dans la liste */
  waInstances: [],
  selectedWaInstance: "",
  waChats: [],
  waMessages: [],
  selectedWaRemoteJid: "",
  /** Comptes Nylas (index + clientId public), depuis /api/config */
  runtimeAccounts: [],
  apiUrl: "https://api.eu.nylas.com",
  selectedAccountIndex: 1
};

const WA_INSTANCE_STORAGE_KEY = "inbox-wa-evolution-instance";
const NYLAS_ACCOUNT_STORAGE_KEY = "inbox-nylas-account-index";
const ALL_GRANTS_VALUE = "__ALL__";
const GRANT_SCOPE_SEPARATOR = "::";
const ALL_MODE_MAX_CONCURRENCY = 4;
/** Instance Nylas Connect recréée lors d’un changement de compte */
let nylasConnect = null;

function normalizeRuntimeAccounts(cfg) {
  if (Array.isArray(cfg.accounts) && cfg.accounts.length) {
    return cfg.accounts;
  }
  const cid = cfg.inboxClientId || cfg.clientId;
  if (cid) {
    return [{ index: 1, clientId: cid }];
  }
  return [];
}

function pickSavedAccountIndex() {
  const ids = state.runtimeAccounts.map((a) => a.index);
  if (!ids.length) {
    return 1;
  }
  let saved = "";
  try {
    saved = localStorage.getItem(NYLAS_ACCOUNT_STORAGE_KEY) || "";
  } catch (_e) {
    saved = "";
  }
  const n = Number.parseInt(saved, 10);
  if (Number.isFinite(n) && ids.includes(n)) {
    return n;
  }
  return ids[0];
}

function getSelectedClientId() {
  const row = state.runtimeAccounts.find((a) => a.index === state.selectedAccountIndex);
  return row?.clientId || "";
}

function fillAccountSelect() {
  if (!accountSelectEl) {
    return; 
  }
  accountSelectEl.innerHTML = "";
  for (const acc of state.runtimeAccounts) {
    const opt = document.createElement("option");
    opt.value = String(acc.index);
    opt.textContent = String(acc.index);
    accountSelectEl.append(opt);
  }
  if (
    state.selectedAccountIndex &&
    [...accountSelectEl.options].some((o) => Number.parseInt(o.value, 10) === state.selectedAccountIndex)
  ) {
    accountSelectEl.value = String(state.selectedAccountIndex);
  }
}

function appendAccountParam(params, accountIndex = state.selectedAccountIndex) {
  params.set("account", String(accountIndex));
}

function isAllMode() {
  return state.selectedGrantId === ALL_GRANTS_VALUE;
}

function makeGrantScopeValue(accountIndex, grantId) {
  return `${String(accountIndex)}${GRANT_SCOPE_SEPARATOR}${String(grantId)}`;
}

function parseGrantScopeValue(value) {
  if (!value || value === ALL_GRANTS_VALUE) return null;
  const sepIndex = String(value).indexOf(GRANT_SCOPE_SEPARATOR);
  if (sepIndex <= 0) return null;
  const accountRaw = String(value).slice(0, sepIndex);
  const grantId = String(value).slice(sepIndex + GRANT_SCOPE_SEPARATOR.length).trim();
  const accountIndex = Number.parseInt(accountRaw, 10);
  if (!Number.isFinite(accountIndex) || accountIndex < 1 || !grantId) {
    return null;
  }
  return { accountIndex, grantId };
}

function getSelectedGrantScope() {
  if (isAllMode() || !state.selectedGrantId || !state.selectedGrantAccountIndex) {
    return null;
  }
  return {
    accountIndex: state.selectedGrantAccountIndex,
    grantId: state.selectedGrantId
  };
}

function buildMessageKey(accountIndex, grantId, messageId) {
  return `${String(accountIndex)}:${String(grantId)}:${String(messageId)}`;
}

function clearEmailSelection() {
  state.selectedMessageId = "";
  state.selectedMessageKey = "";
  state.nextCursor = "";
  state.detailById.clear();
  state.messageScopeById.clear();
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Array.isArray(items) || !items.length) return [];
  const limit = Math.max(1, Number.parseInt(String(concurrency), 10) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function reinitNylasSession() {
  const clientId = getSelectedClientId();
  if (!clientId) {
    return;
  }
  nylasConnect = new NylasConnect({
    clientId,
    redirectUri: `${window.location.origin}/auth/callback`,
    apiUrl: state.apiUrl,
    environment: "development",
    persistTokens: true
  });
  const session = await nylasConnect.getSession();
  state.sessionGrantId = session?.grantId || "";
}

function getEmailOnlyElements() {
  return document.querySelectorAll("[data-email-only]");
}

function createSourceTabs() {
  if (!toolbarEl || document.getElementById("sourceTabs")) return;
  const tabs = document.createElement("div");
  tabs.id = "sourceTabs";
  tabs.setAttribute("role", "tablist");
  tabs.style.display = "inline-flex";
  tabs.style.gap = "6px";
  tabs.style.marginRight = "10px";

  const emailBtn = document.createElement("button");
  emailBtn.type = "button";
  emailBtn.dataset.sourceTab = "1";
  emailBtn.dataset.source = "email";
  emailBtn.textContent = "Email";

  const waBtn = document.createElement("button");
  waBtn.type = "button";
  waBtn.dataset.sourceTab = "1";
  waBtn.dataset.source = "whatsapp";
  waBtn.textContent = "WhatsApp";

  tabs.append(emailBtn, waBtn);
  toolbarEl.insertBefore(tabs, toolbarEl.firstChild);
}

function renderSourceTabs() {
  document.querySelectorAll('button[data-source-tab="1"]').forEach((button) => {
    const active = button.dataset.source === state.source;
    button.style.background = active ? "#1d4ed8" : "#1f2937";
    button.style.borderColor = active ? "#60a5fa" : "#374151";
    button.style.color = "#e5e7eb";
    button.style.borderWidth = "1px";
    button.style.borderStyle = "solid";
    button.style.borderRadius = "8px";
    button.style.padding = "8px 10px";
    button.style.cursor = "pointer";
  });
}

function updateToolbarForSource() {
  const isEmail = state.source === "email";
  getEmailOnlyElements().forEach((el) => {
    el.hidden = !isEmail;
  });
  if (waInstanceLabelEl) {
    waInstanceLabelEl.hidden = isEmail;
  }
  if (waInstanceSelectEl) {
    waInstanceSelectEl.hidden = isEmail;
  }
  const mailboxTabs = document.getElementById("mailboxTabs");
  if (mailboxTabs) {
    mailboxTabs.style.display = isEmail ? "inline-flex" : "none";
  }
  if (readFilterEl) {
    readFilterEl.disabled = !isEmail;
  }
  if (deleteGrantBtn) {
    deleteGrantBtn.disabled = !isEmail || isAllMode();
  }
}

function createMailboxTabs() {
  if (!toolbarEl) return;
  const tabs = document.createElement("div");
  tabs.id = "mailboxTabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("data-email-only", "");
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

  const othersBtn = document.createElement("button");
  othersBtn.type = "button";
  othersBtn.dataset.mailbox = "OTHERS";
  othersBtn.dataset.mailboxTab = "1";
  othersBtn.textContent = "Others";

  tabs.append(inboxBtn, sentBtn, othersBtn, trashBtn);
  toolbarEl.insertBefore(tabs, statusEl);
  if (deleteGrantBtn) {
    toolbarEl.insertBefore(deleteGrantBtn, statusEl);
  }
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

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null;
      const id = typeof attachment.id === "string" && attachment.id.trim() ? attachment.id.trim() : "";
      const filename =
        typeof attachment.filename === "string" && attachment.filename.trim()
          ? attachment.filename.trim()
          : "Fichier sans nom";
      const contentType =
        typeof attachment.contentType === "string" && attachment.contentType.trim()
          ? attachment.contentType.trim().split(";")[0].trim()
          : "";
      const size = Number(attachment.size);
      return {
        id,
        filename,
        contentType,
        size: Number.isFinite(size) && size >= 0 ? size : null
      };
    })
    .filter(Boolean);
}

function renderReaderPlaceholder(text) {
  readerPanelEl.innerHTML = `<p class="empty">${escapeHtml(text)}</p>`;
}

function formatScopeLabel(message) {
  const accountIndex = Number(message?.__accountIndex);
  const grantId = typeof message?.__grantId === "string" ? message.__grantId : "";
  if (!Number.isFinite(accountIndex) || !grantId) return "";
  return `Acc ${accountIndex} • ${grantId.slice(0, 8)}`;
}

function renderSidebarList() {
  if (state.source === "whatsapp") {
    const rows = state.waChats;
    if (!rows.length) {
      messagesListEl.innerHTML =
        '<p class="empty">Aucune conversation (ou filtre trop restrictif).</p>';
      return;
    }
    messagesListEl.innerHTML = rows
      .map((chat) => {
        const active = chat.remoteJid === state.selectedWaRemoteJid ? "active" : "";
        const date = formatDate(chat.date);
        return `
        <button class="item ${active}" type="button" data-wa-remote-jid="${escapeHtml(chat.remoteJid)}">
          <p class="item-subject">${escapeHtml(chat.subject || chat.remoteJid)}</p>
          <p class="item-meta">${escapeHtml(chat.snippet || "")} ${date ? `- ${escapeHtml(date)}` : ""}</p>
        </button>
      `;
      })
      .join("");
    return;
  }

  if (!state.messages.length) {
    messagesListEl.innerHTML = '<p class="empty">Aucun email pour ce filtre.</p>';
    return;
  }

  messagesListEl.innerHTML = state.messages
    .map((message) => {
      const messageKey =
        typeof message.__messageKey === "string" && message.__messageKey
          ? message.__messageKey
          : buildMessageKey(message.__accountIndex, message.__grantId, message.id || "");
      const counterpart =
        state.mailbox === "SENT"
          ? Array.isArray(message.to)
            ? getAddress(message.to[0])
            : ""
          : Array.isArray(message.from)
            ? getAddress(message.from[0])
            : "";
      const counterpartLabel = state.mailbox === "SENT" ? "A" : "De";
      const subject = message.subject || "(Sans sujet)";
      const date = formatDate(message.date || message.created_at);
      const active = messageKey === state.selectedMessageKey ? "active" : "";
      const scopeLabel = isAllMode() ? formatScopeLabel(message) : "";
      return `
        <button class="item ${active}" type="button"
          data-message-key="${escapeHtml(messageKey)}"
          data-message-id="${escapeHtml(message.id || "")}">
          <p class="item-subject">${escapeHtml(subject)}</p>
          <p class="item-meta">${escapeHtml(counterpartLabel)}: ${escapeHtml(counterpart || "Inconnu")} ${date ? `- ${escapeHtml(date)}` : ""}${scopeLabel ? ` • ${escapeHtml(scopeLabel)}` : ""}</p>
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
  const attachments = normalizeAttachments(message?.attachments);
  const detailScope = message?.__scope || state.messageScopeById.get(state.selectedMessageKey) || null;
  const attachmentsHtml = attachments.length
    ? `
      <section style="margin: 12px 0 14px;">
        <p class="meta" style="margin-bottom: 6px;"><strong>Pieces jointes (${attachments.length})</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          ${attachments
            .map((attachment) => {
              const fileSize = formatFileSize(attachment.size);
              const metaParts = [attachment.contentType, fileSize].filter(Boolean);
              const hasDownloadLink = Boolean(
                attachment.id &&
                detailScope?.grantId &&
                Number.isFinite(Number(detailScope?.accountIndex))
              );
              const params = new URLSearchParams();
              if (hasDownloadLink) {
                appendAccountParam(params, detailScope.accountIndex);
                params.set("grantId", detailScope.grantId);
                params.set("attachmentId", attachment.id);
                params.set("messageId", message?.id || "");
                params.set("filename", attachment.filename);
              }
              const attachmentLabel = hasDownloadLink
                ? `<a href="/api/attachment?${params.toString()}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.filename)}</a>`
                : escapeHtml(attachment.filename);
              return `<li>${attachmentLabel}${
                metaParts.length ? ` <span class="meta">(${escapeHtml(metaParts.join(" - "))})</span>` : ""
              }</li>`;
            })
            .join("")}
        </ul>
      </section>
    `
    : "";
  const deleteButtonLabel =
    state.mailbox === "TRASH" ? "Supprimer definitivement" : "Supprimer cet email";
  const deleteMessageKey = message?.__messageKey || state.selectedMessageKey || "";

  readerPanelEl.innerHTML = `
    <h2>${escapeHtml(subject)}</h2>
    <p>
      <button
        type="button"
        data-delete-message-id="${escapeHtml(message?.id || "")}"
        data-delete-message-key="${escapeHtml(deleteMessageKey)}">
        ${escapeHtml(deleteButtonLabel)}
      </button>
    </p>
    <p class="meta">
      De: ${escapeHtml(from || "Inconnu")}<br />
      A: ${escapeHtml(to || "Inconnu")}<br />
      Date: ${escapeHtml(date || "Inconnue")}
    </p>
    ${attachmentsHtml}
    ${
      hasHtmlBody
        ? `<div class="email-body" style="line-height:1.45;word-break:break-word;">${htmlBody}</div>`
        : `<pre>${escapeHtml(text)}</pre>`
    }
  `;
}

function renderWaThread() {
  const chat = state.waChats.find((c) => c.remoteJid === state.selectedWaRemoteJid);
  const title = chat?.subject || state.selectedWaRemoteJid || "Conversation";

  if (!state.selectedWaRemoteJid) {
    renderReaderPlaceholder("Selectionne une conversation WhatsApp.");
    return;
  }

  if (!state.waMessages.length) {
    readerPanelEl.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <p class="meta">${escapeHtml(state.selectedWaRemoteJid)}</p>
      <p class="empty">Aucun message dans cet historique (ou chargement en cours).</p>
    `;
    return;
  }

  const blocks = state.waMessages
    .map((m) => {
      const who = m.fromMe ? "Moi" : "Contact";
      const when = formatDate(m.date);
      const align = m.fromMe ? "margin-left:18%;" : "margin-right:18%;";
      const bg = m.fromMe ? "#1d4ed8" : "#374151";
      return `
      <div style="${align} margin-bottom:10px; padding:10px 12px; border-radius:10px; background:${bg}; color:#e5e7eb;">
        <p style="margin:0 0 6px; font-size:0.8rem; opacity:0.9;">${escapeHtml(who)} · ${escapeHtml(when || "")}</p>
        <pre style="margin:0; white-space:pre-wrap; font-family:inherit; line-height:1.45;">${escapeHtml(m.bodyText || "")}</pre>
        <p style="margin:8px 0 0;">
          <button type="button"
            data-wa-delete="1"
            data-wa-id="${escapeHtml(m.id)}"
            data-wa-from-me="${m.fromMe ? "1" : "0"}"
            data-wa-remote-jid="${escapeHtml(m.remoteJid || state.selectedWaRemoteJid)}">
            Supprimer pour tous
          </button>
        </p>
      </div>`;
    })
    .join("");

  readerPanelEl.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <p class="meta">JID: ${escapeHtml(state.selectedWaRemoteJid)}</p>
    <div class="wa-thread" style="margin-top:14px;">${blocks}</div>
  `;
}

function updateLoadMoreButton() {
  const hasCursor = Boolean(state.nextCursor);
  const show =
    state.source === "email" && hasCursor && !state.isLoadingMessages && !isAllMode();
  loadMoreBtn.hidden = !show;
}


function pickDefaultWaInstance() {
  const list = state.waInstances;
  if (!list.length) return "";
  const names = list.map((i) => i.name);
  let saved = "";
  try {
    saved = localStorage.getItem(WA_INSTANCE_STORAGE_KEY) || "";
  } catch (_e) {
    saved = "";
  }
  if (saved && names.includes(saved)) return saved;
  const openOne = list.find((i) => String(i.status).toLowerCase() === "open");
  return (openOne && openOne.name) || list[0].name || "";
}

function formatWaInstanceLabel(name) {
  const value = typeof name === "string" ? name.trim() : "";
  const match = /^(\d+)-([a-z]{4})$/i.exec(value);
  if (!match) return value;
  const phone = match[1];
  const suffix = match[2].toLowerCase();
  return `+${phone} - ${suffix}`;
}

function fillWaInstanceSelect() {
  if (!waInstanceSelectEl) return;
  waInstanceSelectEl.innerHTML = "";
  for (const row of state.waInstances) {
    const opt = document.createElement("option");
    opt.value = row.name;
    const st = row.status ? ` (${row.status})` : "";
    const prof = row.profileName ? ` — ${row.profileName}` : "";
    opt.textContent = `${formatWaInstanceLabel(row.name)}${st}${prof}`;
    waInstanceSelectEl.append(opt);
  }
  if (state.selectedWaInstance && [...waInstanceSelectEl.options].some((o) => o.value === state.selectedWaInstance)) {
    waInstanceSelectEl.value = state.selectedWaInstance;
  }
}

async function loadWaInstances() {
  const payload = await fetchJson("/api/wa-instances");
  state.waInstances = Array.isArray(payload?.data) ? payload.data : [];
  state.selectedWaInstance = pickDefaultWaInstance();
  fillWaInstanceSelect();
  try {
    if (state.selectedWaInstance) {
      localStorage.setItem(WA_INSTANCE_STORAGE_KEY, state.selectedWaInstance);
    }
  } catch (_e) {
    /* ignore */
  }
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
  const previousSelectionValue = isAllMode()
    ? ALL_GRANTS_VALUE
    : makeGrantScopeValue(state.selectedGrantAccountIndex, state.selectedGrantId);
  const accountRows = Array.isArray(state.runtimeAccounts) ? state.runtimeAccounts : [];
  const fetchedByAccount = await Promise.all(
    accountRows.map(async (account) => {
      const params = new URLSearchParams();
      appendAccountParam(params, account.index);
      try {
        const payload = await fetchJson(`/api/grants?${params.toString()}`);
        const grants = Array.isArray(payload?.data) ? payload.data : [];
        return { accountIndex: account.index, grants, error: "" };
      } catch (error) {
        return {
          accountIndex: account.index,
          grants: [],
          error: error?.message || "Erreur de chargement des grants"
        };
      }
    })
  );

  state.grantsByAccount = new Map();
  state.allGrantRefs = [];
  for (const row of fetchedByAccount) {
    state.grantsByAccount.set(row.accountIndex, row.grants);
    for (const grant of row.grants) {
      state.allGrantRefs.push({
        accountIndex: row.accountIndex,
        grantId: grant.id,
        displayName: grant.displayName || grant.id,
        provider: grant.provider || "provider",
        grantStatus: grant.grantStatus || ""
      });
    }
  }

  grantSelectEl.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = ALL_GRANTS_VALUE;
  allOption.textContent = "All";
  grantSelectEl.append(allOption);

  if (!state.allGrantRefs.length) {
    state.selectedGrantId = ALL_GRANTS_VALUE;
    state.selectedGrantAccountIndex = 0;
    grantSelectEl.value = ALL_GRANTS_VALUE;
    setStatus("Aucun grant trouve", true);
    renderReaderPlaceholder("Aucun grant.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant.</p>';
    return;
  }

  for (const ref of state.allGrantRefs) {
    const option = document.createElement("option");
    option.value = makeGrantScopeValue(ref.accountIndex, ref.grantId);
    const status = ref.grantStatus ? ` - ${ref.grantStatus}` : "";
    option.textContent = `Acc ${ref.accountIndex} - ${ref.displayName} (${ref.provider}${status})`;
    grantSelectEl.append(option);
  }

  const hasPrevious =
    previousSelectionValue === ALL_GRANTS_VALUE ||
    state.allGrantRefs.some(
      (ref) => makeGrantScopeValue(ref.accountIndex, ref.grantId) === previousSelectionValue
    );
  const nextSelectionValue = hasPrevious ? previousSelectionValue : ALL_GRANTS_VALUE;
  if (nextSelectionValue === ALL_GRANTS_VALUE) {
    state.selectedGrantId = ALL_GRANTS_VALUE;
    state.selectedGrantAccountIndex = 0;
    grantSelectEl.value = ALL_GRANTS_VALUE;
    return;
  }

  const parsed = parseGrantScopeValue(nextSelectionValue);
  if (!parsed) {
    state.selectedGrantId = ALL_GRANTS_VALUE;
    state.selectedGrantAccountIndex = 0;
    grantSelectEl.value = ALL_GRANTS_VALUE;
    return;
  }
  state.selectedGrantId = parsed.grantId;
  state.selectedGrantAccountIndex = parsed.accountIndex;
  grantSelectEl.value = nextSelectionValue;
}

async function deleteGrant() {
  const scope = getSelectedGrantScope();
  if (!scope || state.isDeletingGrant) {
    if (isAllMode()) {
      setStatus("Selectionne un grant precis pour pouvoir le supprimer.", true);
    }
    return;
  }
  const confirmed = window.confirm("Supprimer ce grant ? Cette action est irreversible.");
  if (!confirmed) return;

  state.isDeletingGrant = true;
  setStatus("Suppression du grant...");

  try {
    const params = new URLSearchParams();
    appendAccountParam(params, scope.accountIndex);
    params.set("grantId", scope.grantId);
    await fetchJson(`/api/grants?${params.toString()}`, { method: "DELETE" });

    state.selectedGrantId = ALL_GRANTS_VALUE;
    state.selectedGrantAccountIndex = 0;
    clearEmailSelection();
    state.messages = [];
    renderSidebarList();
    renderReaderPlaceholder("Grant supprime. Selectionne un autre grant.");

    await loadGrants();
    await loadMessages({ append: false });
    setStatus("Grant supprime");
  } catch (error) {
    setStatus(error?.message || "Erreur lors de la suppression du grant", true);
  } finally {
    state.isDeletingGrant = false;
  }
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

function normalizeMessageWithScope(message, scope) {
  const messageId = message?.id || "";
  const messageKey = buildMessageKey(scope.accountIndex, scope.grantId, messageId);
  state.messageScopeById.set(messageKey, {
    accountIndex: scope.accountIndex,
    grantId: scope.grantId,
    messageId
  });
  return {
    ...message,
    __accountIndex: scope.accountIndex,
    __grantId: scope.grantId,
    __messageKey: messageKey
  };
}

function toMessageTimestamp(message) {
  const value = message?.date || message?.created_at;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
}

async function deleteMessage(messageKey) {
  if (!messageKey || state.isDeletingMessage) return;
  const scope = state.messageScopeById.get(messageKey);
  if (!scope?.grantId || !scope?.messageId || !scope?.accountIndex) {
    setStatus("Impossible de determiner la boite de ce message.", true);
    return;
  }

  const isTrash = state.mailbox === "TRASH";
  state.isDeletingMessage = true;
  setStatus(isTrash ? "Suppression definitive..." : "Deplacement dans la corbeille...");

  try {
    const params = new URLSearchParams();
    appendAccountParam(params, scope.accountIndex);
    params.set("grantId", scope.grantId);
    params.set("messageId", scope.messageId);
    await fetchJson(`/api/message?${params.toString()}`, {
      method: isTrash ? "DELETE" : "PATCH"
    });

    state.detailById.delete(messageKey);
    clearEmailSelection();
    await loadMessages({ append: false });

    if (isTrash) {
      const stillExists = state.messages.some((message) => message.__messageKey === messageKey);
      if (stillExists) {
        await fetchJson(`/api/message?${params.toString()}`, { method: "DELETE" });
        state.nextCursor = "";
        await loadMessages({ append: false });
      }

      const existsAfterRetry = state.messages.some((message) => message.__messageKey === messageKey);
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

async function deleteWaMessage(messageId, remoteJid, fromMe) {
  if (!messageId || !remoteJid || !state.selectedWaInstance || state.isDeletingMessage) return;
  state.isDeletingMessage = true;
  setStatus("Suppression WhatsApp...");

  try {
    await fetchJson("/api/wa-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        instance: state.selectedWaInstance,
        id: messageId,
        remoteJid,
        fromMe,
        participant: ""
      })
    });
    state.waMessages = state.waMessages.filter((m) => m.id !== messageId);
    renderWaThread();
    setStatus("Message supprime (WhatsApp)");
  } catch (error) {
    setStatus(error?.message || "Erreur suppression WhatsApp", true);
  } finally {
    state.isDeletingMessage = false;
  }
}

async function loadMessages({ append = false } = {}) {
  const loadSeq = state.emailLoadSeq + 1;
  state.emailLoadSeq = loadSeq;
  state.isLoadingMessages = true;
  updateLoadMoreButton();
  setStatus("Chargement des emails...");

  try {
    if (!append) {
      state.messageScopeById.clear();
    }

    const subject = state.subjectQuery.trim();
    const commonParams = (params) => {
      params.set("limit", "200");
      params.set("mailbox", state.mailbox);
      params.set("read", state.readFilter);
      if (subject) {
        params.set("subject", subject);
      }
    };

    if (isAllMode()) {
      const refs = Array.isArray(state.allGrantRefs) ? state.allGrantRefs : [];
      const perGrant = await mapWithConcurrency(refs, ALL_MODE_MAX_CONCURRENCY, async (ref) => {
        const params = new URLSearchParams();
        appendAccountParam(params, ref.accountIndex);
        params.set("grantId", ref.grantId);
        commonParams(params);
        const endpoint = `/api/messages?${params.toString()}`;
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const payload = await fetchJson(endpoint);
            const data = Array.isArray(payload?.data) ? payload.data : [];
            return {
              items: data.map((message) =>
                normalizeMessageWithScope(message, {
                  accountIndex: ref.accountIndex,
                  grantId: ref.grantId
                })
              ),
              failed: false
            };
          } catch (error) {
            lastError = error;
            const msg = String(error?.message || "").toLowerCase();
            const retryable = msg.includes("429") || msg.includes("rate");
            if (attempt === 0 && retryable) {
              await sleepMs(350);
              continue;
            }
            break;
          }
        }
        return {
          items: [],
          failed: true,
          errorMessage: lastError?.message || "Erreur de chargement"
        };
      });

      const merged = perGrant.flatMap((row) => row.items);
      const dedup = new Map();
      for (const message of merged) {
        dedup.set(message.__messageKey, message);
      }
      if (loadSeq !== state.emailLoadSeq) {
        return;
      }
      state.messages = Array.from(dedup.values()).sort(
        (left, right) => toMessageTimestamp(right) - toMessageTimestamp(left)
      );
      state.nextCursor = "";
      const failedCount = perGrant.filter((row) => row.failed).length;
      if (failedCount > 0) {
        setStatus(
          `${state.messages.length} email(s) charges - ${failedCount} boite(s) partiellement indisponible(s)`,
          true
        );
      }
    } else {
      const scope = getSelectedGrantScope();
      if (loadSeq !== state.emailLoadSeq) {
        return;
      }
      if (!scope) {
        state.messages = [];
        state.nextCursor = "";
        renderSidebarList();
        renderReaderPlaceholder("Selectionne un grant.");
        setStatus("Aucun grant selectionne", true);
        return;
      }
      const params = new URLSearchParams();
      appendAccountParam(params, scope.accountIndex);
      params.set("grantId", scope.grantId);
      commonParams(params);
      if (append && state.nextCursor) {
        params.set("cursor", state.nextCursor);
      }

      const payload = await fetchJson(`/api/messages?${params.toString()}`);
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const normalized = data.map((message) => normalizeMessageWithScope(message, scope));
      if (loadSeq !== state.emailLoadSeq) {
        return;
      }
      state.messages = append ? state.messages.concat(normalized) : normalized;
      state.nextCursor = getNextCursor(payload);
    }

    if (loadSeq !== state.emailLoadSeq) {
      return;
    }
    renderSidebarList();

    if (!append && state.messages.length) {
      state.selectedMessageId = state.messages[0].id || "";
      state.selectedMessageKey = state.messages[0].__messageKey || "";
      renderSidebarList();
      await loadMessageDetail(state.selectedMessageKey);
    } else if (!state.messages.length) {
      state.selectedMessageId = "";
      state.selectedMessageKey = "";
      renderReaderPlaceholder("Aucun email pour ce filtre.");
    }

    if (!isAllMode()) {
      setStatus(`${state.messages.length} email(s) charges`);
    }
  } catch (error) {
    if (loadSeq !== state.emailLoadSeq) {
      return;
    }
    setStatus(error?.message || "Erreur lors du chargement des emails", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible de charger les emails.</p>';
    renderReaderPlaceholder("Impossible de charger le contenu.");
  } finally {
    if (loadSeq === state.emailLoadSeq) {
      state.isLoadingMessages = false;
      updateLoadMoreButton();
    }
  }
}

async function loadWaChats() {
  if (!state.selectedWaInstance) {
    setStatus("Choisis une instance WhatsApp dans la liste.", true);
    messagesListEl.innerHTML = '<p class="empty">Aucune instance disponible ou selectionnee.</p>';
    renderReaderPlaceholder("Selectionne une instance Evolution dans la liste deroulante.");
    return;
  }

  state.isLoadingMessages = true;
  updateLoadMoreButton();
  setStatus("Chargement des conversations WhatsApp...");

  try {
    const params = new URLSearchParams();
    params.set("instance", state.selectedWaInstance);
    const payload = await fetchJson(`/api/wa-chats?${params.toString()}`);
    state.waChats = Array.isArray(payload?.data) ? payload.data : [];

    state.selectedWaRemoteJid = "";
    state.waMessages = [];
    renderSidebarList();

    const rows = state.waChats;
    if (rows.length) {
      state.selectedWaRemoteJid = rows[0].remoteJid;
      renderSidebarList();
      await loadWaMessages();
    } else {
      renderReaderPlaceholder("Aucune conversation WhatsApp.");
      setStatus("0 conversation WhatsApp");
    }
  } catch (error) {
    setStatus(error?.message || "Erreur WhatsApp (chats)", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible de charger WhatsApp.</p>';
    renderReaderPlaceholder("Verifie EVOLUTION_API_URL, EVOLUTION_API_KEY et la connexion de l'instance.");
  } finally {
    state.isLoadingMessages = false;
    updateLoadMoreButton();
  }
}

async function loadWaMessages() {
  if (!state.selectedWaRemoteJid) {
    renderReaderPlaceholder("Selectionne une conversation.");
    return;
  }
  if (!state.selectedWaInstance) {
    renderReaderPlaceholder("Selectionne une instance WhatsApp.");
    return;
  }

  setStatus("Chargement des messages...");
  try {
    const params = new URLSearchParams();
    params.set("instance", state.selectedWaInstance);
    params.set("remoteJid", state.selectedWaRemoteJid);
    const payload = await fetchJson(`/api/wa-messages?${params.toString()}`);
    state.waMessages = Array.isArray(payload?.data) ? payload.data : [];
    renderWaThread();
    setStatus(`${state.waMessages.length} message(s) WhatsApp`);
  } catch (error) {
    setStatus(error?.message || "Erreur chargement messages WA", true);
    state.waMessages = [];
    renderWaThread();
  }
}

async function loadMessageDetail(messageKey) {
  if (!messageKey) return;
  const scope = state.messageScopeById.get(messageKey);
  if (!scope?.grantId || !scope?.messageId || !scope?.accountIndex) return;

  if (state.detailById.has(messageKey)) {
    renderReader(state.detailById.get(messageKey));
    return;
  }

  renderReaderPlaceholder("Chargement du contenu...");
  try {
    const params = new URLSearchParams();
    appendAccountParam(params, scope.accountIndex);
    params.set("grantId", scope.grantId);
    params.set("messageId", scope.messageId);
    const payload = await fetchJson(`/api/message?${params.toString()}`);
    const detail = payload?.data || null;
    if (!detail) {
      throw new Error("Aucun détail trouvé");
    }
    const scopedDetail = {
      ...detail,
      __scope: scope,
      __messageKey: messageKey
    };
    state.detailById.set(messageKey, scopedDetail);
    renderReader(scopedDetail);
  } catch (error) {
    renderReaderPlaceholder(error?.message || "Erreur de lecture du message.");
  }
}

async function applySubjectSearch() {
  const nextSubjectQuery = (subjectSearchInputEl?.value || "").trim();
  state.subjectQuery = nextSubjectQuery;
  if (subjectSearchInputEl && subjectSearchInputEl.value !== nextSubjectQuery) {
    subjectSearchInputEl.value = nextSubjectQuery;
  }
  clearEmailSelection();
  await loadMessages({ append: false });
}

async function refreshCurrentSource() {
  if (state.source === "email") {
    clearEmailSelection();
    await loadMessages({ append: false });
  } else {
    await loadWaInstances();
    await loadWaChats();
  }
}

function setupEvents() {
  waInstanceSelectEl?.addEventListener("change", async () => {
    if (state.source !== "whatsapp") return;
    const v = waInstanceSelectEl.value || "";
    state.selectedWaInstance = v;
    try {
      if (v) localStorage.setItem(WA_INSTANCE_STORAGE_KEY, v);
    } catch (_e) {
      /* ignore */
    }
    state.waChats = [];
    state.waMessages = [];
    state.selectedWaRemoteJid = "";
    await loadWaChats();
  });

  accountSelectEl?.addEventListener("focus", async () => {
    if (state.source !== "email") {
      return;
    }
    await loadGrants();
    updateToolbarForSource();
  });

  accountSelectEl?.addEventListener("change", async () => {
    if (state.source !== "email") {
      return;
    }
    const v = Number.parseInt(accountSelectEl.value, 10);
    state.selectedAccountIndex = Number.isFinite(v) && v >= 1 ? v : 1;
    try {
      localStorage.setItem(NYLAS_ACCOUNT_STORAGE_KEY, String(state.selectedAccountIndex));
    } catch (_e) {
      /* ignore */
    }
    clearEmailSelection();
    state.messages = [];
    await reinitNylasSession();
    await loadGrants();
    updateToolbarForSource();
    await loadMessages({ append: false });
  });

  grantSelectEl.addEventListener("change", async () => {
    if (state.source !== "email") return;
    const rawValue = grantSelectEl.value;
    if (rawValue === ALL_GRANTS_VALUE) {
      state.selectedGrantId = ALL_GRANTS_VALUE;
      state.selectedGrantAccountIndex = 0;
    } else {
      const parsed = parseGrantScopeValue(rawValue);
      if (!parsed) {
        state.selectedGrantId = ALL_GRANTS_VALUE;
        state.selectedGrantAccountIndex = 0;
      } else {
        state.selectedGrantId = parsed.grantId;
        state.selectedGrantAccountIndex = parsed.accountIndex;
      }
    }
    clearEmailSelection();
    updateToolbarForSource();
    await loadMessages({ append: false });
  });

  deleteGrantBtn?.addEventListener("click", async () => {
    if (state.source !== "email") return;
    await deleteGrant();
  });

  readFilterEl?.addEventListener("change", async () => {
    if (state.source !== "email") return;
    state.readFilter = readFilterEl.value || "all";
    clearEmailSelection();
    await loadMessages({ append: false });
  });

  subjectSearchInputEl?.addEventListener("keydown", async (event) => {
    if (state.source !== "email") return;
    const isEnter =
      event.key === "Enter" ||
      event.code === "Enter" ||
      event.code === "NumpadEnter" ||
      event.keyCode === 13;
    if (!isEnter) return;
    event.preventDefault();
    await applySubjectSearch();
  });

  subjectSearchBtnEl?.addEventListener("click", async () => {
    if (state.source !== "email") return;
    await applySubjectSearch();
  });

  toolbarEl?.addEventListener("click", async (event) => {
    const sourceBtn = event.target.closest('button[data-source-tab="1"]');
    if (sourceBtn && sourceBtn.dataset.source && sourceBtn.dataset.source !== state.source) {
      state.source = sourceBtn.dataset.source;
      renderSourceTabs();
      updateToolbarForSource();
      clearEmailSelection();
      state.messages = [];
      state.waMessages = [];
      state.selectedWaRemoteJid = "";
      if (state.source === "email") {
        await loadGrants();
        updateToolbarForSource();
        await loadMessages({ append: false });
      } else {
        try {
          await loadWaInstances();
        } catch (error) {
          setStatus(error?.message || "Impossible de lister les instances WhatsApp", true);
          state.waInstances = [];
          state.selectedWaInstance = "";
          if (waInstanceSelectEl) waInstanceSelectEl.innerHTML = "";
          messagesListEl.innerHTML = '<p class="empty">Instances WhatsApp introuvables.</p>';
          renderReaderPlaceholder("Verifie EVOLUTION_API_URL et EVOLUTION_API_KEY.");
          return;
        }
        await loadWaChats();
      }
      return;
    }

    const button = event.target.closest('button[data-mailbox-tab="1"]');
    if (!button) return;
    const mailbox = ["INBOX", "SENT", "OTHERS", "TRASH"].includes(button.dataset.mailbox)
      ? button.dataset.mailbox
      : "INBOX";
    if (mailbox === state.mailbox) return;
    state.mailbox = mailbox;
    clearEmailSelection();
    renderMailboxTabs();
    await loadMessages({ append: false });
  });

  refreshBtn?.addEventListener("click", async () => {
    await refreshCurrentSource();
  });

  loadMoreBtn.addEventListener("click", async () => {
    if (state.source !== "email" || isAllMode()) return;
    await loadMessages({ append: true });
  });

  messagesListEl.addEventListener("click", async (event) => {
    const waBtn = event.target.closest("button[data-wa-remote-jid]");
    if (waBtn && state.source === "whatsapp") {
      const jid = waBtn.dataset.waRemoteJid;
      if (!jid || jid === state.selectedWaRemoteJid) return;
      state.selectedWaRemoteJid = jid;
      renderSidebarList();
      await loadWaMessages();
      return;
    }

    const button = event.target.closest("button[data-message-key]");
    if (!button || state.source !== "email") return;
    const messageKey = button.dataset.messageKey;
    const messageId = button.dataset.messageId || "";
    if (!messageKey) return;
    state.selectedMessageId = messageId;
    state.selectedMessageKey = messageKey;
    renderSidebarList();
    await loadMessageDetail(messageKey);
  });

  readerPanelEl.addEventListener("click", async (event) => {
    const waDel = event.target.closest("button[data-wa-delete]");
    if (waDel && state.source === "whatsapp") {
      const id = waDel.dataset.waId;
      const remoteJid = waDel.dataset.waRemoteJid;
      const fromMe = waDel.dataset.waFromMe === "1";
      if (!id || !remoteJid) return;
      await deleteWaMessage(id, remoteJid, fromMe);
      return;
    }

    const button = event.target.closest("button[data-delete-message-id]");
    if (!button || state.source !== "email") return;
    const messageKey = button.dataset.deleteMessageKey || state.selectedMessageKey || "";
    if (!messageKey) return;
    await deleteMessage(messageKey);
  });
}

async function bootstrap() {
  try {
    setStatus("Initialisation...");
    createSourceTabs();
    renderSourceTabs();
    createMailboxTabs();
    renderMailboxTabs();
    updateToolbarForSource();
    const cfg = await loadRuntimeConfig();
    state.runtimeAccounts = normalizeRuntimeAccounts(cfg);
    state.apiUrl = cfg.apiUrl || "https://api.eu.nylas.com";
    if (!state.runtimeAccounts.length) {
      throw new Error("Aucun compte Nylas dans la configuration");
    }
    state.selectedAccountIndex = pickSavedAccountIndex();
    fillAccountSelect();
    if (accountSelectEl) {
      accountSelectEl.value = String(state.selectedAccountIndex);
    }
    if (subjectSearchInputEl) {
      subjectSearchInputEl.value = state.subjectQuery;
    }
    await reinitNylasSession();

    setupEvents();
    await loadGrants();
    updateToolbarForSource();
    await loadMessages({ append: false });
  } catch (error) {
    setStatus(error?.message || "Erreur d'initialisation", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible d’initialiser Inbox.</p>';
    renderReaderPlaceholder("Vérifie ta session OAuth puis réessaye.");
  }
}

await bootstrap();
