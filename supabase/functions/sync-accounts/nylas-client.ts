const FETCH_TIMEOUT_MS = 10000;

export interface NylasGrant {
  id: string;
  provider: string;
  email: string | null;
  grantStatus: string;
  displayName: string;
  createdAt: string | null;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeGrant(raw: Record<string, unknown>): NylasGrant | null {
  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!id) return null;
  const provider = typeof raw?.provider === "string" ? raw.provider : "unknown";
  const email = typeof raw?.email === "string" ? raw.email : null;
  const grantStatus = typeof raw?.grant_status === "string"
    ? raw.grant_status.toLowerCase()
    : "unknown";
  const name = typeof raw?.name === "string" ? raw.name : "";
  const displayName = email || name || id;
  const createdAtRaw = raw?.created_at ?? raw?.createdAt ?? raw?.created;
  let createdAt: string | null = null;
  if (createdAtRaw !== undefined && createdAtRaw !== null) {
    const asNumber = Number(createdAtRaw);
    if (Number.isFinite(asNumber)) {
      const ms = asNumber > 1e11 ? asNumber : asNumber * 1000;
      const d = new Date(ms);
      createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
    } else if (typeof createdAtRaw === "string") {
      const d = new Date(createdAtRaw);
      createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
  return { id, provider, email, grantStatus, displayName, createdAt };
}

export async function listNylasGrants(
  apiUrl: string,
  apiKey: string,
): Promise<NylasGrant[]> {
  const grants: NylasGrant[] = [];
  let nextCursor: string | null = null;
  let safety = 10;

  do {
    const url = new URL(`${apiUrl}/v3/grants`);
    url.searchParams.set("limit", "200");
    if (nextCursor) url.searchParams.set("page_token", nextCursor);

    const res = await fetchWithTimeout(url.toString(), {
      headers: buildHeaders(apiKey),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Nylas list grants failed (${res.status}): ${text}`);
    }

    const payload = await res.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const row of rows) {
      const normalized = normalizeGrant(row);
      if (normalized) grants.push(normalized);
    }

    nextCursor = typeof payload?.next_cursor === "string" &&
        payload.next_cursor.length
      ? payload.next_cursor
      : null;
    safety -= 1;
  } while (nextCursor && safety > 0);

  return grants;
}

export function countValidGrants(grants: NylasGrant[]): number {
  return grants.filter((g) => g.grantStatus === "valid").length;
}
