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
const waInstanceHintEl = document.getElementById("waInstanceHint");
const waInstanceNameEl = document.getElementById("waInstanceName");
const subjectSearchLabelEl = document.getElementById("subjectSearchLabel");

const state = {
  source: "email",
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
  isDeletingMessage: false,
  /** WhatsApp (Evolution) — instance unique via env */
  waChats: [],
  waMessages: [],
  selectedWaRemoteJid: "",
  waInstanceName: ""
};

let searchDebounce = null;

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
  if (waInstanceHintEl) {
    waInstanceHintEl.hidden = isEmail;
  }
  if (waInstanceNameEl && state.waInstanceName) {
    waInstanceNameEl.textContent = state.waInstanceName;
  }
  const mailboxTabs = document.getElementById("mailboxTabs");
  if (mailboxTabs) {
    mailboxTabs.style.display = isEmail ? "inline-flex" : "none";
  }
  if (subjectSearchEl) {
    subjectSearchEl.placeholder = isEmail
      ? "Rechercher par sujet..."
      : "Filtrer les conversations...";
  }
  if (subjectSearchLabelEl) {
    subjectSearchLabelEl.textContent = isEmail ? "Sujet" : "Filtrer";
  }
  if (readFilterEl) {
    readFilterEl.disabled = !isEmail;
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

function getFilteredWaChats() {
  const q = state.subject.trim().toLowerCase();
  if (!q) return state.waChats;
  return state.waChats.filter((chat) => {
    const sub = String(chat.subject || "").toLowerCase();
    const snip = String(chat.snippet || "").toLowerCase();
    const jid = String(chat.remoteJid || "").toLowerCase();
    return sub.includes(q) || snip.includes(q) || jid.includes(q);
  });
}

function renderSidebarList() {
  if (state.source === "whatsapp") {
    const rows = getFilteredWaChats();
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
  const attachments = normalizeAttachments(message?.attachments);
  const attachmentsHtml = attachments.length
    ? `
      <section style="margin: 12px 0 14px;">
        <p class="meta" style="margin-bottom: 6px;"><strong>Pieces jointes (${attachments.length})</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          ${attachments
            .map((attachment) => {
              const fileSize = formatFileSize(attachment.size);
              const metaParts = [attachment.contentType, fileSize].filter(Boolean);
              const hasDownloadLink = Boolean(attachment.id && state.selectedGrantId);
              const params = new URLSearchParams();
              if (hasDownloadLink) {
                params.set("grantId", state.selectedGrantId);
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
    state.source === "email" && hasCursor && !state.isLoadingMessages;
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

async function deleteWaMessage(messageId, remoteJid, fromMe) {
  if (!messageId || !remoteJid || state.isDeletingMessage) return;
  state.isDeletingMessage = true;
  setStatus("Suppression WhatsApp...");

  try {
    await fetchJson("/api/wa-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
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
    renderSidebarList();

    if (!append && state.messages.length) {
      state.selectedMessageId = state.messages[0].id;
      renderSidebarList();
      await loadMessageDetail(state.selectedMessageId);
    } else if (!state.messages.length) {
      state.selectedMessageId = "";
      renderReaderPlaceholder("Aucun email pour ce filtre.");
    }

    setStatus(`${state.messages.length} email(s) charges`);
  } catch (error) {
    setStatus(error?.message || "Erreur lors du chargement des emails", true);
    messagesListEl.innerHTML = '<p class="empty">Impossible de charger les emails.</p>';
    renderReaderPlaceholder("Impossible de charger le contenu.");
  } finally {
    state.isLoadingMessages = false;
    updateLoadMoreButton();
  }
}

async function loadWaChats() {
  state.isLoadingMessages = true;
  updateLoadMoreButton();
  setStatus("Chargement des conversations WhatsApp...");

  try {
    const payload = await fetchJson("/api/wa-chats");
    state.waChats = Array.isArray(payload?.data) ? payload.data : [];
    state.waInstanceName = typeof payload?.instance === "string" ? payload.instance : "";
    if (waInstanceNameEl) {
      waInstanceNameEl.textContent = state.waInstanceName || "(instance)";
    }

    state.selectedWaRemoteJid = "";
    state.waMessages = [];
    renderSidebarList();

    const rows = getFilteredWaChats();
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
    renderReaderPlaceholder("Verifie EVOLUTION_* et la connexion de l instance.");
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

  setStatus("Chargement des messages...");
  try {
    const params = new URLSearchParams();
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

async function refreshCurrentSource() {
  if (state.source === "email") {
    state.nextCursor = "";
    state.detailById.clear();
    await loadMessages({ append: false });
  } else {
    await loadWaChats();
  }
}

function setupEvents() {
  grantSelectEl.addEventListener("change", async () => {
    if (state.source !== "email") return;
    state.selectedGrantId = grantSelectEl.value;
    state.detailById.clear();
    state.nextCursor = "";
    await loadMessages({ append: false });
  });

  readFilterEl?.addEventListener("change", async () => {
    if (state.source !== "email") return;
    state.readFilter = readFilterEl.value || "all";
    state.nextCursor = "";
    state.selectedMessageId = "";
    state.detailById.clear();
    await loadMessages({ append: false });
  });

  toolbarEl?.addEventListener("click", async (event) => {
    const sourceBtn = event.target.closest('button[data-source-tab="1"]');
    if (sourceBtn && sourceBtn.dataset.source && sourceBtn.dataset.source !== state.source) {
      state.source = sourceBtn.dataset.source;
      renderSourceTabs();
      updateToolbarForSource();
      state.nextCursor = "";
      state.detailById.clear();
      state.selectedMessageId = "";
      state.messages = [];
      state.waMessages = [];
      state.selectedWaRemoteJid = "";
      if (state.source === "email") {
        await loadGrants();
        await loadMessages({ append: false });
      } else {
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
      if (state.source === "email") {
        state.nextCursor = "";
        state.detailById.clear();
        await loadMessages({ append: false });
      } else {
        renderSidebarList();
        /** Resynchroniser la selection si le filtre masque la conversation courante */
        const rows = getFilteredWaChats();
        if (!rows.some((r) => r.remoteJid === state.selectedWaRemoteJid)) {
          state.selectedWaRemoteJid = rows[0]?.remoteJid || "";
          if (state.selectedWaRemoteJid) {
            await loadWaMessages();
          } else {
            state.waMessages = [];
            renderReaderPlaceholder("Aucune conversation pour ce filtre.");
          }
        }
      }
    }, 300);
  });

  clearSearchBtn.addEventListener("click", async () => {
    if (!subjectSearchEl.value) return;
    subjectSearchEl.value = "";
    state.subject = "";
    if (state.source === "email") {
      state.nextCursor = "";
      state.detailById.clear();
      await loadMessages({ append: false });
    } else {
      renderSidebarList();
      if (state.waChats.length && !state.selectedWaRemoteJid) {
        state.selectedWaRemoteJid = state.waChats[0].remoteJid;
        renderSidebarList();
        await loadWaMessages();
      }
    }
  });

  refreshBtn?.addEventListener("click", async () => {
    await refreshCurrentSource();
  });

  loadMoreBtn.addEventListener("click", async () => {
    if (state.source !== "email") return;
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

    const button = event.target.closest("button[data-message-id]");
    if (!button || state.source !== "email") return;
    const messageId = button.dataset.messageId;
    if (!messageId) return;
    state.selectedMessageId = messageId;
    renderSidebarList();
    await loadMessageDetail(messageId);
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
    const messageId = button.dataset.deleteMessageId;
    if (!messageId) return;
    await deleteMessage(messageId);
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
    const connect = new NylasConnect({
      clientId: cfg.inboxClientId || cfg.clientId,
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
