import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
const accountSelectEl = document.getElementById("accountSelect");
const grantDropdownEl = document.getElementById("grantDropdown");
const grantDropdownBtnEl = document.getElementById("grantDropdownBtn");
const grantDropdownBtnTitleEl = document.getElementById("grantDropdownBtnTitle");
const grantDropdownBtnMetaEl = document.getElementById("grantDropdownBtnMeta");
const grantDropdownMenuEl = document.getElementById("grantDropdownMenu");
const subjectSearchInputEl = document.getElementById("subjectSearchInput");
const subjectSearchBtnEl = document.getElementById("subjectSearchBtn");
const refreshBtn = document.getElementById("refreshBtn");
const messagesListEl = document.getElementById("messagesList");
const readerPanelEl = document.getElementById("readerPanel");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const toolbarEl = document.querySelector(".toolbar");


const state = {
  sessionGrantId: "",
  selectedGrantId: "",
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
  /** Comptes Nylas (index + clientId public), depuis /api/config */
  runtimeAccounts: [],
  apiUrl: "https://api.eu.nylas.com",
  selectedAccountIndex: 1
};

const NYLAS_ACCOUNT_STORAGE_KEY = "inbox-nylas-account-index";
const GRANT_SCOPE_SEPARATOR = "::";
const GRANT_QUERY_PARAM = "grant";
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

function makeGrantScopeValue(accountIndex, grantId) {
  return `${String(accountIndex)}${GRANT_SCOPE_SEPARATOR}${String(grantId)}`;
}

function parseGrantScopeValue(value) {
  if (!value) return null;
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

function getGrantScopeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get(GRANT_QUERY_PARAM) || "";
}

function setGrantScopeInUrl(scopeValue, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (scopeValue) {
    url.searchParams.set(GRANT_QUERY_PARAM, scopeValue);
  } else {
    url.searchParams.delete(GRANT_QUERY_PARAM);
  }
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath === currentPath) return;
  if (replace) {
    window.history.replaceState({}, "", nextPath);
  } else {
    window.history.pushState({}, "", nextPath);
  }
}

function getSelectedGrantScope() {
  if (!state.selectedGrantId || !state.selectedGrantAccountIndex) {
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

function updateToolbarForSource() {
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

  const sentBtn = document.createElement("button");
  sentBtn.type = "button";
  sentBtn.dataset.mailbox = "SENT";
  sentBtn.dataset.mailboxTab = "1";
  sentBtn.textContent = "Sent";

  tabs.append(inboxBtn, sentBtn);
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

function parseAnyDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    // Supports Unix seconds and Unix milliseconds.
    const ms = numeric > 1e11 ? numeric : numeric * 1000;
    const dateFromNumber = new Date(ms);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }
  const dateFromString = new Date(String(value));
  return Number.isNaN(dateFromString.getTime()) ? null : dateFromString;
}

function formatDate(value) {
  const date = parseAnyDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function toUnixTimestampSeconds(value) {
  const date = parseAnyDate(value);
  if (!date) return 0;
  return Math.floor(date.getTime() / 1000);
}

function pickGrantCreatedAt(grant) {
  if (!grant || typeof grant !== "object") return "";
  return (
    grant.createdAt ||
    grant.created_at ||
    grant.createdOn ||
    grant.created_on ||
    grant.createdTimestamp ||
    grant.created_timestamp ||
    grant.creationDate ||
    grant.creation_date ||
    grant.created ||
    ""
  );
}

function closeGrantDropdown() {
  if (!grantDropdownMenuEl || !grantDropdownBtnEl) return;
  grantDropdownMenuEl.hidden = true;
  grantDropdownBtnEl.setAttribute("aria-expanded", "false");
}

function openGrantDropdown() {
  if (!grantDropdownMenuEl || !grantDropdownBtnEl || grantDropdownBtnEl.disabled) return;
  grantDropdownMenuEl.hidden = false;
  grantDropdownBtnEl.setAttribute("aria-expanded", "true");
}

function renderGrantDropdown() {
  if (
    !grantDropdownEl ||
    !grantDropdownBtnEl ||
    !grantDropdownBtnTitleEl ||
    !grantDropdownBtnMetaEl ||
    !grantDropdownMenuEl
  ) {
    return;
  }

  grantDropdownMenuEl.innerHTML = "";
  const selectedScopeValue =
    state.selectedGrantId && state.selectedGrantAccountIndex
      ? makeGrantScopeValue(state.selectedGrantAccountIndex, state.selectedGrantId)
      : "";

  if (!state.allGrantRefs.length) {
    grantDropdownBtnTitleEl.textContent = "Aucun grant";
    grantDropdownBtnMetaEl.textContent = "Aucun grant charge";
    grantDropdownBtnEl.disabled = true;
    closeGrantDropdown();
    const empty = document.createElement("p");
    empty.className = "grant-empty";
    empty.textContent = "Aucun grant disponible.";
    grantDropdownMenuEl.append(empty);
    return;
  }

  grantDropdownBtnEl.disabled = false;
  const selectedRef = state.allGrantRefs.find(
    (ref) => makeGrantScopeValue(ref.accountIndex, ref.grantId) === selectedScopeValue
  );
  const fallbackRef = state.allGrantRefs[0];
  const activeRef = selectedRef || fallbackRef;
  const createdAtLabel = formatDate(activeRef?.createdAt);
  grantDropdownBtnTitleEl.innerHTML = "";
  const activeDot = document.createElement("span");
  activeDot.className = `grant-status-dot ${activeRef?.isValid ? "is-valid" : "is-invalid"}`;
  activeDot.setAttribute("aria-hidden", "true");
  const activeTitleText = document.createElement("span");
  activeTitleText.className = "grant-title-text";
  activeTitleText.textContent = activeRef?.displayName || activeRef?.grantId || "Grant";
  grantDropdownBtnTitleEl.append(activeDot, activeTitleText);
  if (activeRef?.tag) {
    const activeTag = document.createElement("span");
    activeTag.className = "grant-tag";
    activeTag.textContent = activeRef.tag;
    grantDropdownBtnTitleEl.append(activeTag);
  }
  grantDropdownBtnMetaEl.textContent = `Acc ${activeRef?.accountIndex || ""} • ${activeRef?.provider || "provider"}${
    createdAtLabel ? ` • Cree le ${createdAtLabel}` : ""
  }`;

  for (const ref of state.allGrantRefs) {
    if (!ref.isValid) continue;
    const scopeValue = makeGrantScopeValue(ref.accountIndex, ref.grantId);
    const isActive = scopeValue === selectedScopeValue;
    const statusLabel = ref.isValid ? "valid" : "invalid";
    const createdLabel = formatDate(ref.createdAt);

    const item = document.createElement("button");
    item.type = "button";
    item.className = `grant-option${isActive ? " active" : ""}`;
    item.dataset.grantScopeValue = scopeValue;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", isActive ? "true" : "false");

    const title = document.createElement("p");
    title.className = "grant-option-title";
    const dot = document.createElement("span");
    dot.className = `grant-status-dot ${ref.isValid ? "is-valid" : "is-invalid"}`;
    dot.setAttribute("aria-hidden", "true");
    const titleText = document.createElement("span");
    titleText.className = "grant-title-text";
    titleText.textContent = ref.displayName;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "grant-copy-btn";
    copyBtn.title = "Copier l'email";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(ref.displayName).then(() => {
        copyBtn.classList.add("copied");
        setTimeout(() => copyBtn.classList.remove("copied"), 1200);
      });
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "grant-copy-btn grant-delete-btn";
    delBtn.title = "Supprimer le grant";
    delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      state.selectedGrantId = ref.grantId;
      state.selectedGrantAccountIndex = ref.accountIndex;
      await deleteGrant();
    });

    if (ref.tag) {
      const tagBadge = document.createElement("span");
      tagBadge.className = "grant-tag";
      tagBadge.textContent = ref.tag;
      title.append(dot, titleText, tagBadge, copyBtn, delBtn);
    } else {
      title.append(dot, titleText, copyBtn, delBtn);
    }

    const meta = document.createElement("p");
    meta.className = "grant-option-meta";
    meta.textContent = `Acc ${ref.accountIndex} • ${ref.provider} • ${statusLabel}${
      createdLabel ? ` • Cree le ${createdLabel}` : ""
    }`;

    item.append(title, meta);
    grantDropdownMenuEl.append(item);
  }
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

function renderSidebarList() {
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
      const tags = [];
      tags.push(message.unread
        ? '<span class="item-tag tag-unread">Non lu</span>'
        : '<span class="item-tag tag-read">Lu</span>');
      if (message.starred) tags.push('<span class="item-tag tag-starred">★</span>');
      const HIDDEN_FOLDERS = new Set(["UNREAD", "INBOX", "SENT", "DRAFT", "STARRED"]);
      const folders = Array.isArray(message.folders) ? message.folders : [];
      for (const f of folders) {
        const name = typeof f === "string" ? f : (f?.name || f?.display_name || "");
        if (name && !HIDDEN_FOLDERS.has(name.toUpperCase())) {
          const upper = name.toUpperCase();
          const label = upper === "TRASH" ? "Trash" : name.replace(/^CATEGORY_/i, "");
          const cls = upper === "TRASH" ? "tag-trash" : "tag-folder";
          tags.push(`<span class="item-tag ${cls}">${escapeHtml(label)}</span>`);
        }
      }

      return `
        <button class="item ${active}" type="button"
          data-message-key="${escapeHtml(messageKey)}"
          data-message-id="${escapeHtml(message.id || "")}">
          <p class="item-subject">${escapeHtml(subject)}</p>
          <p class="item-meta">${escapeHtml(counterpartLabel)}: ${escapeHtml(counterpart || "Inconnu")} ${date ? `- ${escapeHtml(date)}` : ""}</p>
          <div class="item-tags">${tags.join("")}</div>
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

function updateLoadMoreButton() {
  const hasCursor = Boolean(state.nextCursor);
  const show = hasCursor && !state.isLoadingMessages;
  loadMoreBtn.hidden = !show;
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
    const err = new Error(data?.error || data?.details?.error || "Erreur API");
    err.grantInvalid = Boolean(data?.grantInvalid);
    throw err;
  }
  return data;
}

async function loadGrants() {
  const previousSelectionValue =
    state.selectedGrantId && state.selectedGrantAccountIndex
      ? makeGrantScopeValue(state.selectedGrantAccountIndex, state.selectedGrantId)
      : "";
  const urlSelectionValue = getGrantScopeFromUrl();
  const accountRows = Array.isArray(state.runtimeAccounts) ? state.runtimeAccounts : [];
  const fetchedByAccount = await Promise.all(
    accountRows.map(async (account) => {
      const params = new URLSearchParams();
      appendAccountParam(params, account.index);
      try {
        const payload = await fetchJson(`/api/grants?${params.toString()}`);
        if (payload?.source !== "supabase") {
          throw new Error("Source grants invalide: Supabase requis");
        }
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
      const createdAt = pickGrantCreatedAt(grant);
      const createdAtTs = toUnixTimestampSeconds(createdAt);
      const grantStatusRaw = String(grant.grantStatus || "").trim();
      const isValid = grantStatusRaw.toLowerCase() === "valid";
      state.allGrantRefs.push({
        accountIndex: row.accountIndex,
        grantId: grant.id,
        displayName: grant.displayName || grant.id,
        provider: grant.provider || "provider",
        grantStatus: grantStatusRaw,
        isValid,
        createdAt,
        createdAtTs,
        tag: grant.tag || null
      });
    }
  }

  state.allGrantRefs.sort((left, right) => right.createdAtTs - left.createdAtTs);

  if (!state.allGrantRefs.length) {
    state.selectedGrantId = "";
    state.selectedGrantAccountIndex = 0;
    setGrantScopeInUrl("", { replace: true });
    renderGrantDropdown();
    setStatus("Aucun grant trouve", true);
    renderReaderPlaceholder("Aucun grant.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant.</p>';
    return;
  }

  const validGrantRefs = state.allGrantRefs.filter((ref) => ref.isValid);

  if (!validGrantRefs.length) {
    state.selectedGrantId = "";
    state.selectedGrantAccountIndex = 0;
    setGrantScopeInUrl("", { replace: true });
    renderGrantDropdown();
    setStatus("Aucun grant valide trouve", true);
    renderReaderPlaceholder("Aucun grant valide.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant valide.</p>';
    return;
  }

  const hasPrevious = validGrantRefs.some(
    (ref) => makeGrantScopeValue(ref.accountIndex, ref.grantId) === previousSelectionValue
  );
  const hasUrlSelection = validGrantRefs.some(
    (ref) => makeGrantScopeValue(ref.accountIndex, ref.grantId) === urlSelectionValue
  );
  const nextSelectionValue = hasUrlSelection
    ? urlSelectionValue
    : hasPrevious
      ? previousSelectionValue
      : makeGrantScopeValue(validGrantRefs[0].accountIndex, validGrantRefs[0].grantId);

  const parsed = parseGrantScopeValue(nextSelectionValue);
  if (!parsed) {
    state.selectedGrantId = "";
    state.selectedGrantAccountIndex = 0;
    setGrantScopeInUrl("", { replace: true });
    renderGrantDropdown();
    return;
  }
  state.selectedGrantId = parsed.grantId;
  state.selectedGrantAccountIndex = parsed.accountIndex;
  setGrantScopeInUrl(nextSelectionValue, { replace: true });
  renderGrantDropdown();
}

async function deleteGrant() {
  const scope = getSelectedGrantScope();
  if (!scope || state.isDeletingGrant) {
    setStatus("Selectionne un grant precis pour pouvoir le supprimer.", true);
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

    state.selectedGrantId = "";
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

    const searchQuery = state.subjectQuery.trim();
    const commonParams = (params) => {
      params.set("limit", "200");
      params.set("mailbox", state.mailbox);
      params.set("read", state.readFilter);
      if (searchQuery) {
        params.set("q", searchQuery);
      }
    };

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

    setStatus(`${state.messages.length} email(s) charges`);
  } catch (error) {
    if (loadSeq !== state.emailLoadSeq) {
      return;
    }
    if (error?.grantInvalid) {
      setStatus("Grant invalide — rechargement...", true);
      messagesListEl.innerHTML = '<p class="empty">Ce grant n\'est plus accessible.</p>';
      renderReaderPlaceholder("Ce grant a ete revoque ou supprime cote Nylas.");
      await loadGrants();
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
  clearEmailSelection();
  await loadMessages({ append: false });
}

async function selectGrantScope(scopeValue, { syncUrl = true, replaceHistory = false } = {}) {
  const parsed = parseGrantScopeValue(scopeValue);
  let selectedScopeValue = "";
  if (!parsed) {
    state.selectedGrantId = "";
    state.selectedGrantAccountIndex = 0;
  } else {
    state.selectedGrantId = parsed.grantId;
    state.selectedGrantAccountIndex = parsed.accountIndex;
    selectedScopeValue = makeGrantScopeValue(parsed.accountIndex, parsed.grantId);
  }
  if (syncUrl) {
    setGrantScopeInUrl(selectedScopeValue, { replace: replaceHistory });
  }
  closeGrantDropdown();
  renderGrantDropdown();
  clearEmailSelection();
  updateToolbarForSource();
  await loadMessages({ append: false });
}

function setupEvents() {
  accountSelectEl?.addEventListener("focus", async () => {
    await loadGrants();
    updateToolbarForSource();
  });

  accountSelectEl?.addEventListener("change", async () => {
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

  grantDropdownBtnEl?.addEventListener("click", () => {
    if (!grantDropdownMenuEl) return;
    if (grantDropdownMenuEl.hidden) {
      openGrantDropdown();
    } else {
      closeGrantDropdown();
    }
  });

  grantDropdownMenuEl?.addEventListener("click", async (event) => {
    const option = event.target.closest("button[data-grant-scope-value]");
    const scopeValue = option?.dataset.grantScopeValue || "";
    if (!scopeValue) return;
    await selectGrantScope(scopeValue);
  });

  document.addEventListener("click", (event) => {
    if (!grantDropdownEl || grantDropdownMenuEl?.hidden) return;
    if (!grantDropdownEl.contains(event.target)) {
      closeGrantDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeGrantDropdown();
    }
  });

  window.addEventListener("popstate", async () => {
    const scopeFromUrl = getGrantScopeFromUrl();
    const currentScope =
      state.selectedGrantId && state.selectedGrantAccountIndex
        ? makeGrantScopeValue(state.selectedGrantAccountIndex, state.selectedGrantId)
        : "";
    if (scopeFromUrl === currentScope) return;
    const existsInCurrentList = state.allGrantRefs.some(
      (ref) => makeGrantScopeValue(ref.accountIndex, ref.grantId) === scopeFromUrl
    );
    if (!existsInCurrentList) {
      await loadGrants();
      updateToolbarForSource();
      await loadMessages({ append: false });
      return;
    }
    await selectGrantScope(scopeFromUrl, { syncUrl: false });
  });

  subjectSearchInputEl?.addEventListener("keydown", async (event) => {
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
    await applySubjectSearch();
  });

  toolbarEl?.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-mailbox-tab="1"]');
    if (!button) return;
    const mailbox = ["INBOX", "SENT"].includes(button.dataset.mailbox)
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
    await loadMessages({ append: true });
  });

  messagesListEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-message-key]");
    if (!button) return;
    const messageKey = button.dataset.messageKey;
    const messageId = button.dataset.messageId || "";
    if (!messageKey) return;
    state.selectedMessageId = messageId;
    state.selectedMessageKey = messageKey;
    renderSidebarList();
    await loadMessageDetail(messageKey);
  });

  readerPanelEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-delete-message-id]");
    if (!button) return;
    const messageKey = button.dataset.deleteMessageKey || state.selectedMessageKey || "";
    if (!messageKey) return;
    await deleteMessage(messageKey);
  });
}

// ─── Grant Stats Modal ───
const statsBtnEl = document.getElementById("statsBtn");
const statsModalEl = document.getElementById("statsModal");
const statsModalCloseEl = document.getElementById("statsModalClose");
const statsModalBodyEl = document.getElementById("statsModalBody");
const statsBackdropEl = statsModalEl?.querySelector(".stats-modal-backdrop");

let chartInstance = null;

function openStatsModal() {
  if (!statsModalEl) return;
  statsModalEl.hidden = false;
  loadStats();
}

function closeStatsModal() {
  if (!statsModalEl) return;
  statsModalEl.hidden = true;
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

const STATUS_COLORS = {
  valid: "#22c55e",
  unauthorized: "#f59e0b",
  done: "#60a5fa",
  deleted_on_nylas: "#ef4444",
  invalid: "#6b7280",
  unknown: "#4b5563"
};

async function loadStats() {
  if (!statsModalBodyEl) return;
  statsModalBodyEl.innerHTML = '<p class="empty">Chargement...</p>';

  try {
    const params = new URLSearchParams();
    appendAccountParam(params);
    const resp = await fetch(`/api/grants-stats?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderStats(data);
  } catch (err) {
    statsModalBodyEl.innerHTML = `<p class="empty">Erreur: ${err.message}</p>`;
  }
}

function renderStats(data) {
  if (!statsModalBodyEl) return;
  const { overview, daily, by_status, by_account, weekly_retention } = data;

  const churnPct = overview.total ? ((overview.soft_deleted / overview.total) * 100).toFixed(1) : "0";
  const validPct = overview.total ? ((overview.valid / overview.total) * 100).toFixed(1) : "0";

  let html = "";

  // KPI Cards
  html += `<div class="stats-kpis">
    <div class="stats-kpi"><div class="stats-kpi-value blue">${overview.total}</div><div class="stats-kpi-label">Total grants</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value green">${overview.valid} <small style="font-size:0.7rem;color:#9ca3af">(${validPct}%)</small></div><div class="stats-kpi-label">Valides</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value red">${churnPct}%</div><div class="stats-kpi-label">Taux churn</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value amber">${overview.unique_emails}</div><div class="stats-kpi-label">Emails uniques</div></div>
  </div>`;

  // Extra KPIs row
  const avgRevoke = overview.avg_time_to_revoke_hours != null
    ? (overview.avg_time_to_revoke_hours < 24
      ? `${overview.avg_time_to_revoke_hours}h`
      : `${(overview.avg_time_to_revoke_hours / 24).toFixed(1)}j`)
    : "—";
  html += `<div class="stats-kpis" style="margin-top:-10px">
    <div class="stats-kpi"><div class="stats-kpi-value" style="font-size:1.2rem">${overview.accounts}</div><div class="stats-kpi-label">Comptes Nylas</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value" style="font-size:1.2rem;color:#f97316">${overview.revoked || 0}</div><div class="stats-kpi-label">Révoqués</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value" style="font-size:1.2rem;color:#f97316">${avgRevoke}</div><div class="stats-kpi-label">Durée moy. révocation</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value" style="font-size:1.2rem">${overview.deleted_on_nylas}</div><div class="stats-kpi-label">Deleted on Nylas</div></div>
  </div>`;

  // Line chart
  html += `<div class="stats-chart-wrap">
    <h3>Acquisition par jour</h3>
    <canvas id="statsLineChart"></canvas>
  </div>`;

  // Status distribution bars
  const maxCount = by_status.length ? Math.max(...by_status.map(s => s.count)) : 1;
  html += `<div class="stats-chart-wrap"><h3>Répartition par statut</h3><ul class="stats-status-list">`;
  for (const s of by_status) {
    const pct = ((s.count / maxCount) * 100).toFixed(0);
    const color = STATUS_COLORS[s.status] || STATUS_COLORS.unknown;
    html += `<li class="stats-status-item">
      <span class="stats-status-label">${s.status}</span>
      <span class="stats-status-bar-bg"><span class="stats-status-bar" style="width:${pct}%;background:${color}"></span></span>
      <span class="stats-status-count">${s.count}</span>
    </li>`;
  }
  html += `</ul></div>`;

  // Account table
  html += `<div class="stats-chart-wrap"><h3>Par compte Nylas</h3><table class="stats-table">
    <thead><tr><th>Account</th><th>Total</th><th>Valides</th><th>Supprimés</th><th>Rétention</th></tr></thead><tbody>`;
  for (const a of by_account) {
    const retention = a.total ? (((a.total - a.deleted) / a.total) * 100).toFixed(0) : "—";
    html += `<tr>
      <td>#${a.account_id}</td><td>${a.total}</td><td>${a.valid}</td><td>${a.deleted}</td>
      <td>${retention}%</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;

  // Weekly retention
  if (weekly_retention.length) {
    html += `<div class="stats-chart-wrap"><h3>Rétention hebdomadaire</h3><table class="stats-table">
      <thead><tr><th>Semaine</th><th>Créés</th><th>Supprimés</th><th>Rétention</th></tr></thead><tbody>`;
    for (const w of weekly_retention) {
      const ret = w.created ? (((w.created - w.deleted) / w.created) * 100).toFixed(0) : "—";
      html += `<tr><td>${w.week}</td><td>${w.created}</td><td>${w.deleted}</td><td>${ret}%</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Insights callout
  const insights = [];
  if (Number(churnPct) > 50) insights.push(`Churn critique : ${churnPct}% des grants sont supprimés`);
  if (overview.accounts === 1) insights.push("Mono-provider : 100% Google");
  if (daily.length >= 2) {
    const topDay = [...daily].sort((a, b) => b.total - a.total)[0];
    if (topDay) insights.push(`Pic : ${topDay.total} grants le ${topDay.day}`);
  }
  if (overview.valid < overview.total * 0.25) insights.push(`Seulement ${validPct}% de grants valides`);

  if (insights.length) {
    html += `<div class="stats-insights"><h3>Insights</h3><ul>`;
    for (const i of insights) html += `<li>${i}</li>`;
    html += `</ul></div>`;
  }

  statsModalBodyEl.innerHTML = html;

  // Render Chart.js line chart
  if (daily.length) {
    renderLineChart(daily);
  }
}

async function renderLineChart(daily) {
  try {
    const { Chart, registerables } = await import("https://esm.sh/chart.js@4.4.7");
    Chart.register(...registerables);

    const canvas = document.getElementById("statsLineChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: daily.map(d => d.day.slice(5)),
        datasets: [
          {
            label: "Total créés",
            data: daily.map(d => d.total),
            borderColor: "#60a5fa",
            backgroundColor: "rgba(96,165,250,0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: "Valides",
            data: daily.map(d => d.valid),
            borderColor: "#22c55e",
            backgroundColor: "rgba(34,197,94,0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: "Révoqués",
            data: daily.map(d => d.revoked || 0),
            borderColor: "#f97316",
            backgroundColor: "rgba(249,115,22,0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderDash: [5, 3]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#9ca3af", boxWidth: 12, padding: 14 }
          },
          tooltip: {
            backgroundColor: "#1e293b",
            titleColor: "#e5e7eb",
            bodyColor: "#d1d5db",
            borderColor: "#374151",
            borderWidth: 1
          }
        },
        scales: {
          x: {
            ticks: { color: "#6b7280", font: { size: 11 } },
            grid: { color: "rgba(55,65,81,0.3)" }
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#6b7280", font: { size: 11 }, stepSize: 1 },
            grid: { color: "rgba(55,65,81,0.3)" }
          }
        }
      }
    });
  } catch (err) {
    console.warn("Chart.js load failed:", err);
  }
}

statsBtnEl?.addEventListener("click", openStatsModal);
statsModalCloseEl?.addEventListener("click", closeStatsModal);
statsBackdropEl?.addEventListener("click", closeStatsModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !statsModalEl?.hidden) closeStatsModal();
});

// ─── Grant Info Modal ───
const grantInfoBtnEl = document.getElementById("grantInfoBtn");
const grantInfoModalEl = document.getElementById("grantInfoModal");
const grantInfoModalCloseEl = document.getElementById("grantInfoModalClose");
const grantInfoModalBodyEl = document.getElementById("grantInfoModalBody");
const grantInfoBackdropEl = grantInfoModalEl?.querySelector(".stats-modal-backdrop");

function openGrantInfoModal() {
  if (!grantInfoModalEl) return;
  grantInfoModalEl.hidden = false;
  loadGrantInfo();
}

function closeGrantInfoModal() {
  if (!grantInfoModalEl) return;
  grantInfoModalEl.hidden = true;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR");
}

function formatDateRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `il y a ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `il y a ${day} j`;
  return d.toLocaleDateString("fr-FR");
}

async function loadGrantInfo() {
  if (!grantInfoModalBodyEl) return;

  const grantId = state.selectedGrantId;
  if (!grantId) {
    grantInfoModalBodyEl.innerHTML = '<p class="empty">Aucun grant sélectionné. Choisis un grant dans le dropdown puis ré-ouvre ce panneau.</p>';
    return;
  }

  grantInfoModalBodyEl.innerHTML = '<p class="empty">Chargement...</p>';

  try {
    const params = new URLSearchParams();
    params.set("grantId", grantId);
    const resp = await fetch(`/api/grant-details?${params.toString()}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    renderGrantInfo(data.grant || {});
  } catch (err) {
    grantInfoModalBodyEl.innerHTML = `<p class="empty">Erreur: ${escapeHtml(err?.message || "inconnue")}</p>`;
  }
}

function renderGrantInfo(grant) {
  if (!grantInfoModalBodyEl) return;

  const details = (grant && typeof grant.details === "object" && grant.details) || {};
  const status = String(grant?.grant_status || "unknown").toLowerCase();
  const statusClass = `status-${status}`;
  const provider = grant?.provider || "unknown";
  const email = grant?.email || grant?.display_name || "—";
  const scannedRel = details.scanned_at ? formatDateRelative(details.scanned_at) : null;
  const createdRel = grant?.nylas_created_at ? formatDateRelative(grant.nylas_created_at) : null;

  let html = "";

  // Header identité
  html += `<div class="gi-header">
    <div class="gi-header-top">
      <span class="gi-email">${escapeHtml(email)}</span>
      <span class="gi-badge ${statusClass}">${escapeHtml(status)}</span>
      <span class="gi-badge provider">${escapeHtml(provider)}</span>
    </div>
    <div class="gi-subtitle">
      ${createdRel ? `Créé ${escapeHtml(createdRel)}` : ""}${createdRel && scannedRel ? " · " : ""}${scannedRel ? `Scanné ${escapeHtml(scannedRel)}` : ""}
    </div>
  </div>`;

  // KPIs principaux
  const inboxTotal = details.inbox_total;
  const sentTotal = details.sent_total;
  const contacts = details.contacts;
  const events7d = details.events_7d;

  html += `<div class="stats-kpis">
    <div class="stats-kpi"><div class="stats-kpi-value blue">${formatNumber(inboxTotal)}</div><div class="stats-kpi-label">Inbox</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value green">${formatNumber(sentTotal)}</div><div class="stats-kpi-label">Envoyés</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value amber">${formatNumber(contacts)}</div><div class="stats-kpi-label">Contacts</div></div>
    <div class="stats-kpi"><div class="stats-kpi-value">${formatNumber(events7d)}</div><div class="stats-kpi-label">Évts 7j</div></div>
  </div>`;

  // Barres activité
  const unread = Number(details.inbox_unread || 0);
  const inboxN = Number(details.inbox_total || 0);
  const unreadPct = inboxN > 0 ? Math.round((unread / inboxN) * 100) : 0;
  const messages30d = Number(details.messages_30d || 0);
  const maxActivity = Math.max(inboxN, messages30d, 1);
  const msg30Pct = Math.round((messages30d / maxActivity) * 100);

  html += `<div class="stats-chart-wrap">
    <h3>Activité</h3>
    <ul class="stats-status-list">
      <li class="stats-status-item">
        <span class="stats-status-label">Non lus</span>
        <span class="stats-status-bar-bg"><span class="stats-status-bar" style="width:${unreadPct}%;background:#f59e0b"></span></span>
        <span class="stats-status-count">${formatNumber(unread)} (${unreadPct}%)</span>
      </li>
      <li class="stats-status-item">
        <span class="stats-status-label">Messages 30j</span>
        <span class="stats-status-bar-bg"><span class="stats-status-bar" style="width:${msg30Pct}%;background:#60a5fa"></span></span>
        <span class="stats-status-count">${formatNumber(messages30d)}</span>
      </li>
    </ul>
  </div>`;

  // Wallets détectés
  const walletList = (details.wallet_list && typeof details.wallet_list === "object") ? details.wallet_list : {};
  const walletEntries = Object.entries(walletList).sort((a, b) => Number(b[1]) - Number(a[1]));
  const walletFilter = details.wallet_scan_filter || "—";
  const walletWindow = details.wallet_scan_window_months ? `${details.wallet_scan_window_months} mois` : "—";
  const walletSaturated = Number(details.wallet_scan_saturated || 0);
  const walletChunks = Number(details.wallet_scan_chunks || 0);

  html += `<div class="stats-chart-wrap">
    <h3>Wallets détectés (${walletEntries.length}) · fenêtre ${escapeHtml(walletWindow)} · filtre ${escapeHtml(walletFilter)}</h3>`;

  if (walletEntries.length) {
    const maxCount = Number(walletEntries[0][1]) || 1;
    html += `<ul class="stats-status-list">`;
    for (const [domain, count] of walletEntries) {
      const c = Number(count) || 0;
      const pct = Math.max(2, Math.round((c / maxCount) * 100));
      html += `<li class="stats-status-item">
        <span class="stats-status-label" style="min-width:160px">${escapeHtml(domain)}</span>
        <span class="stats-status-bar-bg"><span class="stats-status-bar" style="width:${pct}%;background:#22c55e"></span></span>
        <span class="stats-status-count">${formatNumber(c)}</span>
      </li>`;
    }
    html += `</ul>`;
    if (walletSaturated > 0) {
      html += `<p style="margin:10px 0 0;font-size:0.75rem;color:#f59e0b">⚠ ${walletSaturated}/${walletChunks} chunks saturés (plafond 200 atteint) — counts potentiellement sous-estimés</p>`;
    }
  } else {
    html += `<div class="gi-empty-state">Aucun wallet détecté pour ce grant dans la fenêtre ${escapeHtml(walletWindow)}.</div>`;
  }
  html += `</div>`;

  // Sujets 90j
  const subjects90d = (details.subjects_90d && typeof details.subjects_90d === "object") ? details.subjects_90d : {};
  const subjectEntries = Object.entries(subjects90d)
    .map(([k, v]) => [k, Number(v) || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  html += `<div class="stats-chart-wrap">
    <h3>Sujets transactionnels (90 jours)</h3>`;
  if (subjectEntries.length) {
    html += `<div class="gi-chips">`;
    for (const [label, count] of subjectEntries) {
      html += `<span class="gi-chip">${escapeHtml(label)}<span class="gi-chip-count">${formatNumber(count)}</span></span>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="gi-empty-state">Aucun sujet transactionnel détecté dans les 90 derniers jours.</div>`;
  }
  html += `</div>`;

  // Metadata
  const phone = grant?.phone || "—";
  const tag = grant?.tag || "—";
  const folders = details.folders_count != null ? details.folders_count : "—";
  const calendars = details.calendars != null ? details.calendars : "—";
  const starred = details.starred != null ? details.starred : "—";

  html += `<div class="stats-chart-wrap">
    <h3>Metadata</h3>
    <div class="gi-meta-grid">
      <div class="gi-meta-item"><span class="gi-meta-label">Grant ID</span><span class="gi-meta-value">${escapeHtml(grant?.grant_id || "—")}</span></div>
      <div class="gi-meta-item"><span class="gi-meta-label">Tag</span><span class="gi-meta-value">${escapeHtml(tag)}</span></div>
      <div class="gi-meta-item"><span class="gi-meta-label">Téléphone</span><span class="gi-meta-value">${escapeHtml(phone)}</span></div>
      <div class="gi-meta-item"><span class="gi-meta-label">Folders</span><span class="gi-meta-value">${formatNumber(folders)}</span></div>
      <div class="gi-meta-item"><span class="gi-meta-label">Calendriers</span><span class="gi-meta-value">${formatNumber(calendars)}</span></div>
      <div class="gi-meta-item"><span class="gi-meta-label">Starred</span><span class="gi-meta-value">${formatNumber(starred)}</span></div>
    </div>
  </div>`;

  grantInfoModalBodyEl.innerHTML = html;
}

grantInfoBtnEl?.addEventListener("click", openGrantInfoModal);
grantInfoModalCloseEl?.addEventListener("click", closeGrantInfoModal);
grantInfoBackdropEl?.addEventListener("click", closeGrantInfoModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !grantInfoModalEl?.hidden) closeGrantInfoModal();
});

async function bootstrap() {
  try {
    setStatus("Initialisation...");
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
