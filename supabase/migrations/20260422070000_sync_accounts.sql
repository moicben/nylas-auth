-- Extensions pour cron + HTTP
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Table pour tracer chaque run de la sync
create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  accounts_scanned integer default 0,
  grants_upserted integer default 0,
  grants_soft_deleted integer default 0,
  status text,
  errors jsonb
);

create index if not exists sync_logs_started_at_idx
  on public.sync_logs (started_at desc);

-- Advisory lock helper pour empêcher deux runs simultanés de l'EF
create or replace function public.try_sync_lock(lock_key bigint)
returns boolean
language plpgsql
security definer
as $$
begin
  return pg_try_advisory_lock(lock_key);
end;
$$;

grant execute on function public.try_sync_lock(bigint) to service_role;

-- Table privée pour stocker la service_role_key utilisée par le cron.
-- (alter database ... set app.xxx = '...' est refusé par le rôle supabase_admin
--  depuis l'API MCP/SQL ; on passe par une table dédiée en schéma privé.)
create schema if not exists private;
create table if not exists private.app_config (
  key text primary key,
  value text not null
);
revoke all on schema private from public, anon, authenticated;
revoke all on table private.app_config from public, anon, authenticated;

-- Insertion de la service_role_key : à faire manuellement via SQL Editor
--   insert into private.app_config (key, value)
--   values ('service_role_key', '<SERVICE_ROLE_KEY>')
--   on conflict (key) do update set value = excluded.value;

-- Cron job : POST vers l'Edge Function toutes les 2 minutes, en lisant la clé
-- depuis private.app_config.
do $$
declare
  job_id integer;
begin
  select jobid into job_id from cron.job where jobname = 'sync-nylas-accounts-every-2m';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end;
$$;

select cron.schedule(
  'sync-nylas-accounts-every-2m',
  '*/2 * * * *',
  $cron$
    select net.http_post(
      url := 'https://vgijwvybcggjkezzxatg.supabase.co/functions/v1/sync-accounts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select value from private.app_config where key = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 120000
    );
  $cron$
);
