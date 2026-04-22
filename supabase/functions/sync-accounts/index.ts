import { createClient } from "jsr:@supabase/supabase-js@2";
import { countValidGrants, listNylasGrants, type NylasGrant } from "./nylas-client.ts";

const NYLAS_API_URL = Deno.env.get("NYLAS_API_URL") ?? "https://api.eu.nylas.com";
const CONCURRENCY = 5;
const ADVISORY_LOCK_KEY = 773301;

interface Account {
  id: string;
  client_id: string;
  api_key: string;
  domain: string | null;
  grants_count: number | null;
}

interface AccountResult {
  accountId: string;
  clientId: string;
  upserted: number;
  softDeleted: number;
  validCount: number;
  error?: string;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

function grantToRow(
  grant: NylasGrant,
  accountId: string,
  syncedAtIso: string,
): Record<string, unknown> {
  return {
    account_id: accountId,
    grant_id: grant.id,
    provider: grant.provider,
    email: grant.email,
    display_name: grant.displayName,
    grant_status: grant.grantStatus,
    nylas_created_at: grant.createdAt,
    last_checked_at: syncedAtIso,
    synced_at: syncedAtIso,
    deleted_at: null,
  };
}

async function syncAccount(
  supabase: ReturnType<typeof createClient>,
  account: Account,
): Promise<AccountResult> {
  const syncedAtIso = new Date().toISOString();
  const result: AccountResult = {
    accountId: account.id,
    clientId: account.client_id,
    upserted: 0,
    softDeleted: 0,
    validCount: 0,
  };

  let nylasGrants: NylasGrant[] = [];
  try {
    nylasGrants = await listNylasGrants(NYLAS_API_URL, account.api_key);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  result.validCount = countValidGrants(nylasGrants);

  if (nylasGrants.length) {
    const rows = nylasGrants.map((g) => grantToRow(g, account.id, syncedAtIso));
    const { error: upsertError } = await supabase
      .from("grants")
      .upsert(rows, { onConflict: "account_id,grant_id" });
    if (upsertError) {
      result.error = `upsert failed: ${upsertError.message}`;
      return result;
    }
    result.upserted = rows.length;
  }

  const activeIds = new Set(nylasGrants.map((g) => g.id));
  const { data: existing, error: listError } = await supabase
    .from("grants")
    .select("grant_id, grant_status")
    .eq("account_id", account.id)
    .is("deleted_at", null);

  if (listError) {
    result.error = `list existing failed: ${listError.message}`;
    return result;
  }

  const missing = (existing ?? [])
    .filter((row) => row.grant_id && !activeIds.has(row.grant_id));

  if (missing.length) {
    const nowIso = new Date().toISOString();
    const { error: softDeleteError } = await supabase
      .from("grants")
      .update({
        deleted_at: nowIso,
        synced_at: nowIso,
        last_checked_at: nowIso,
        grant_status: "missing_on_nylas_sync",
      })
      .eq("account_id", account.id)
      .in("grant_id", missing.map((r) => r.grant_id))
      .is("deleted_at", null);

    if (softDeleteError) {
      result.error = `soft delete failed: ${softDeleteError.message}`;
      return result;
    }
    result.softDeleted = missing.length;
  }

  const { error: updateError } = await supabase
    .from("accounts")
    .update({ grants_count: result.validCount })
    .eq("id", account.id);

  if (updateError) {
    result.error = `grants_count update failed: ${updateError.message}`;
    return result;
  }

  return result;
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase env vars" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const startedAt = new Date().toISOString();

  const { data: lockData, error: lockError } = await supabase.rpc(
    "try_sync_lock",
    { lock_key: ADVISORY_LOCK_KEY },
  );
  if (lockError) {
    console.error("advisory lock rpc failed", lockError);
  } else if (lockData === false) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "another run in progress" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, client_id, api_key, domain, grants_count")
    .order("id", { ascending: true });

  if (accountsError) {
    return new Response(
      JSON.stringify({ error: accountsError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const list = (accounts ?? []) as Account[];
  const results = await runWithConcurrency(list, CONCURRENCY, (a) =>
    syncAccount(supabase, a));

  const finishedAt = new Date().toISOString();
  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
  const totalSoftDeleted = results.reduce((s, r) => s + r.softDeleted, 0);
  const errors = results.filter((r) => r.error).map((r) => ({
    accountId: r.accountId,
    clientId: r.clientId,
    error: r.error,
  }));

  await supabase.from("sync_logs").insert({
    started_at: startedAt,
    finished_at: finishedAt,
    accounts_scanned: list.length,
    grants_upserted: totalUpserted,
    grants_soft_deleted: totalSoftDeleted,
    status: errors.length ? (errors.length === list.length ? "failed" : "partial") : "ok",
    errors: errors.length ? errors : null,
  });

  return new Response(
    JSON.stringify({
      startedAt,
      finishedAt,
      accountsScanned: list.length,
      grantsUpserted: totalUpserted,
      grantsSoftDeleted: totalSoftDeleted,
      errors,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
