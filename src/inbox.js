import { NylasConnect } from "https://esm.sh/@nylas/connect";

const statusEl = document.getElementById("status");
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
  mailbox: "INBOX",
  readFilter: "all",
  subjectQuery: "",
  messages: [],
  selectedMessageId: "",
  selectedMessageKey: "",
  nextCursor: "",
  detailById: new Map(),
  messageScopeById: new Map(),
  allGrantRefs: [],
  emailLoadSeq: 0,
  isLoadingMessages: false,
  isDeletingMessage: false,
  isDeletingGrant: false,
  apiUrl: "https://api.eu.nylas.com",
  clientId: ""
};

const GRANT_QUERY_PARAM = "grant";
let nylasConnect = null;

function buildMessageKey(grantId, messageId) {
  return `${String(grantId)}:${String(messageId)}`;
}

function getGrantFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get(GRANT_QUERY_PARAM) || "";
}

function setGrantInUrl(grantId, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (grantId) {
    url.searchParams.set(GRANT_QUERY_PARAM, grantId);
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

function clearEmailSelection() {
  state.selectedMessageId = "";
  state.selectedMessageKey = "";
  state.nextCursor = "";
  state.detailById.clear();
  state.messageScopeById.clear();
}

async function initNylasSession() {
  if (!state.clientId) return;
  nylasConnect = new NylasConnect({
    clientId: state.clientId,
    redirectUri: `${window.location.origin}/auth/callback`,
    apiUrl: state.apiUrl,
    environment: "development",
    persistTokens: true
  });
  const session = await nylasConnect.getSession();
  state.sessionGrantId = session?.grantId || "";
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
  const selectedGrantId = state.selectedGrantId || "";

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
  const selectedRef = state.allGrantRefs.find((ref) => ref.grantId === selectedGrantId);
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
  grantDropdownBtnMetaEl.textContent = `${activeRef?.provider || "provider"}${
    createdAtLabel ? ` • Cree le ${createdAtLabel}` : ""
  }`;

  for (const ref of state.allGrantRefs) {
    if (!ref.isValid) continue;
    const isActive = ref.grantId === selectedGrantId;
    const statusLabel = ref.isValid ? "valid" : "invalid";
    const createdLabel = formatDate(ref.createdAt);

    const item = document.createElement("button");
    item.type = "button";
    item.className = `grant-option${isActive ? " active" : ""}`;
    item.dataset.grantId = ref.grantId;
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
      await deleteGrant();
    });

    title.append(dot, titleText, copyBtn, delBtn);

    const meta = document.createElement("p");
    meta.className = "grant-option-meta";
    meta.textContent = `${ref.provider} • ${statusLabel}${
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
    .replace(/[ -‏  ­]/g, "")
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
          : buildMessageKey(message.__grantId, message.id || "");
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
              const hasDownloadLink = Boolean(attachment.id && detailScope?.grantId);
              const params = new URLSearchParams();
              if (hasDownloadLink) {
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
  const previousGrantId = state.selectedGrantId || "";
  const urlGrantId = getGrantFromUrl();

  try {
    const payload = await fetchJson(`/api/grants`);
    const grants = Array.isArray(payload?.data) ? payload.data : [];
    state.allGrantRefs = grants.map((grant) => {
      const createdAt = grant.createdAt || "";
      const grantStatusRaw = String(grant.grantStatus || "").trim();
      return {
        grantId: grant.id,
        displayName: grant.displayName || grant.id,
        provider: grant.provider || "provider",
        grantStatus: grantStatusRaw,
        isValid: grantStatusRaw.toLowerCase() === "valid",
        createdAt,
        createdAtTs: toUnixTimestampSeconds(createdAt)
      };
    });
  } catch (error) {
    state.allGrantRefs = [];
    setStatus(error?.message || "Erreur de chargement des grants", true);
  }

  state.allGrantRefs.sort((left, right) => right.createdAtTs - left.createdAtTs);

  if (!state.allGrantRefs.length) {
    state.selectedGrantId = "";
    setGrantInUrl("", { replace: true });
    renderGrantDropdown();
    setStatus("Aucun grant trouve", true);
    renderReaderPlaceholder("Aucun grant.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant.</p>';
    return;
  }

  const validGrantRefs = state.allGrantRefs.filter((ref) => ref.isValid);

  if (!validGrantRefs.length) {
    state.selectedGrantId = "";
    setGrantInUrl("", { replace: true });
    renderGrantDropdown();
    setStatus("Aucun grant valide trouve", true);
    renderReaderPlaceholder("Aucun grant valide.");
    messagesListEl.innerHTML = '<p class="empty">Aucun grant valide.</p>';
    return;
  }

  const hasPrevious = validGrantRefs.some((ref) => ref.grantId === previousGrantId);
  const hasUrl = validGrantRefs.some((ref) => ref.grantId === urlGrantId);
  const nextGrantId = hasUrl
    ? urlGrantId
    : hasPrevious
      ? previousGrantId
      : validGrantRefs[0].grantId;

  state.selectedGrantId = nextGrantId;
  setGrantInUrl(nextGrantId, { replace: true });
  renderGrantDropdown();
}

async function deleteGrant() {
  if (!state.selectedGrantId || state.isDeletingGrant) {
    setStatus("Selectionne un grant precis pour pouvoir le supprimer.", true);
    return;
  }
  state.isDeletingGrant = true;
  setStatus("Suppression du grant...");

  try {
    const params = new URLSearchParams();
    params.set("grantId", state.selectedGrantId);
    await fetchJson(`/api/grants?${params.toString()}`, { method: "DELETE" });

    state.selectedGrantId = "";
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

function normalizeMessageWithScope(message, grantId) {
  const messageId = message?.id || "";
  const messageKey = buildMessageKey(grantId, messageId);
  state.messageScopeById.set(messageKey, { grantId, messageId });
  return {
    ...message,
    __grantId: grantId,
    __messageKey: messageKey
  };
}

async function deleteMessage(messageKey) {
  if (!messageKey || state.isDeletingMessage) return;
  const scope = state.messageScopeById.get(messageKey);
  if (!scope?.grantId || !scope?.messageId) {
    setStatus("Impossible de determiner la boite de ce message.", true);
    return;
  }

  const isTrash = state.mailbox === "TRASH";
  state.isDeletingMessage = true;
  setStatus(isTrash ? "Suppression definitive..." : "Deplacement dans la corbeille...");

  try {
    const params = new URLSearchParams();
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

    const grantId = state.selectedGrantId;
    if (loadSeq !== state.emailLoadSeq) return;
    if (!grantId) {
      state.messages = [];
      state.nextCursor = "";
      renderSidebarList();
      renderReaderPlaceholder("Selectionne un grant.");
      setStatus("Aucun grant selectionne", true);
      return;
    }
    const params = new URLSearchParams();
    params.set("grantId", grantId);
    commonParams(params);
    if (append && state.nextCursor) {
      params.set("cursor", state.nextCursor);
    }

    const payload = await fetchJson(`/api/messages?${params.toString()}`);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const normalized = data.map((message) => normalizeMessageWithScope(message, grantId));
    if (loadSeq !== state.emailLoadSeq) return;
    state.messages = append ? state.messages.concat(normalized) : normalized;
    state.nextCursor = getNextCursor(payload);

    if (loadSeq !== state.emailLoadSeq) return;
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
    if (loadSeq !== state.emailLoadSeq) return;
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
  if (!scope?.grantId || !scope?.messageId) return;

  if (state.detailById.has(messageKey)) {
    renderReader(state.detailById.get(messageKey));
    return;
  }

  renderReaderPlaceholder("Chargement du contenu...");
  try {
    const params = new URLSearchParams();
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

async function selectGrant(grantId, { syncUrl = true, replaceHistory = false } = {}) {
  state.selectedGrantId = grantId || "";
  if (syncUrl) {
    setGrantInUrl(state.selectedGrantId, { replace: replaceHistory });
  }
  closeGrantDropdown();
  renderGrantDropdown();
  clearEmailSelection();
  await loadMessages({ append: false });
}

function setupEvents() {
  grantDropdownBtnEl?.addEventListener("click", () => {
    if (!grantDropdownMenuEl) return;
    if (grantDropdownMenuEl.hidden) {
      openGrantDropdown();
    } else {
      closeGrantDropdown();
    }
  });

  grantDropdownMenuEl?.addEventListener("click", async (event) => {
    const option = event.target.closest("button[data-grant-id]");
    const grantId = option?.dataset.grantId || "";
    if (!grantId) return;
    await selectGrant(grantId);
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
    const grantFromUrl = getGrantFromUrl();
    if (grantFromUrl === state.selectedGrantId) return;
    const existsInCurrentList = state.allGrantRefs.some((ref) => ref.grantId === grantFromUrl);
    if (!existsInCurrentList) {
      await loadGrants();
      await loadMessages({ append: false });
      return;
    }
    await selectGrant(grantFromUrl, { syncUrl: false });
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

const grantCopyEmailBtn = document.getElementById("grantCopyEmailBtn");
grantCopyEmailBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const ref = (state.allGrantRefs || []).find((r) => r.grantId === state.selectedGrantId);
  if (!ref?.displayName) return;
  navigator.clipboard.writeText(ref.displayName).then(() => {
    grantCopyEmailBtn.classList.add("copied");
    setTimeout(() => grantCopyEmailBtn.classList.remove("copied"), 1200);
  });
});

async function bootstrap() {
  try {
    setStatus("Initialisation...");
    createMailboxTabs();
    renderMailboxTabs();
    const cfg = await loadRuntimeConfig();
    state.apiUrl = cfg.apiUrl || "https://api.eu.nylas.com";
    state.clientId = cfg.clientId || "";
    if (!state.clientId) {
      throw new Error("Aucun clientId Nylas dans la configuration");
    }
    if (subjectSearchInputEl) {
      subjectSearchInputEl.value = state.subjectQuery;
    }
    await initNylasSession();

    setupEvents();
    await loadGrants();
    await loadMessages({ append: false });
  } catch (error) {
    setStatus(error?.message || "Erreur d'initialisation", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible d\'initialiser Inbox.</p>';
    renderReaderPlaceholder("Vérifie ta session OAuth puis réessaye.");
  }
}

await bootstrap();
