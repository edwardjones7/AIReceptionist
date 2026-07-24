-- Scarlett schema for CO-LOCATION in the Elenos Supabase project.
-- Everything lives in a dedicated `scarlett` schema so it never touches the
-- Elenos CRM / client-portal tables in `public`. Every object is fully
-- qualified (scarlett.*) — this script cannot create anything in public.
--
-- Run order:
--   1. Run this whole file in the Elenos project's SQL editor.
--   2. Supabase Dashboard → Settings → API → "Exposed schemas": add `scarlett`
--      (keep `public`). Without this, PostgREST rejects scarlett requests.
--   3. Set the app's env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
--      SUPABASE_ANON_KEY → the Elenos project, and SUPABASE_DB_SCHEMA=scarlett.
--
-- Idempotent: safe to re-run.

create schema if not exists scarlett;

-- PostgREST connects as `authenticator` and switches roles. service_role runs
-- our backend queries (and bypasses RLS). anon/authenticated get schema usage
-- only so PostgREST can route — the tables stay RLS-locked with no policies.
grant usage on schema scarlett to service_role, anon, authenticated;

-- ── tenants ──────────────────────────────────────────────────────────────
create table if not exists scarlett.tenants (
  id                   text primary key,
  name                 text not null,
  status               text not null default 'active', -- 'draft' | 'active' | 'paused'
  config               jsonb,
  phone_number         text,
  vapi_assistant_id    text,
  vapi_phone_number_id text,
  business_hours       jsonb,
  calendar_id          text,
  discord_webhook_url  text,
  notify_phone         text,
  owner_numbers        text[] not null default '{}',
  transfer_number      text,
  last_preflight       jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists tenants_vapi_assistant_uidx
  on scarlett.tenants(vapi_assistant_id) where vapi_assistant_id is not null;
create unique index if not exists tenants_vapi_phone_uidx
  on scarlett.tenants(vapi_phone_number_id) where vapi_phone_number_id is not null;

-- ── calls ────────────────────────────────────────────────────────────────
create table if not exists scarlett.calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references scarlett.tenants(id) on delete cascade,
  vapi_call_id  text unique,
  caller_number text,
  started_at    timestamptz,
  ended_at      timestamptz,
  duration_sec  integer,
  outcome       text,
  summary       text,
  recording_url text,
  cost_cents    integer,
  created_at    timestamptz not null default now()
);
create index if not exists calls_tenant_idx on scarlett.calls(tenant_id, created_at desc);

-- ── transcripts ──────────────────────────────────────────────────────────
create table if not exists scarlett.transcripts (
  id       uuid primary key default gen_random_uuid(),
  call_id  uuid not null references scarlett.calls(id) on delete cascade,
  role     text not null,
  text     text not null,
  ts       timestamptz not null default now()
);
create index if not exists transcripts_call_idx on scarlett.transcripts(call_id, ts);

-- ── leads ────────────────────────────────────────────────────────────────
create table if not exists scarlett.leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references scarlett.tenants(id) on delete cascade,
  call_id     uuid references scarlett.calls(id) on delete set null,
  name        text,
  phone       text,
  email       text,
  intent      text,
  details     text,
  qualified   boolean default false,
  status      text default 'new',
  created_at  timestamptz not null default now()
);
create index if not exists leads_tenant_idx on scarlett.leads(tenant_id, created_at desc);

-- ── bookings ─────────────────────────────────────────────────────────────
create table if not exists scarlett.bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references scarlett.tenants(id) on delete cascade,
  call_id         uuid references scarlett.calls(id) on delete set null,
  type            text not null default 'discovery_call',
  name            text,
  phone           text,
  email           text,
  slot_start      timestamptz,
  slot_end        timestamptz,
  gcal_event_id   text,
  status          text default 'confirmed',
  created_at      timestamptz not null default now()
);
create index if not exists bookings_tenant_idx on scarlett.bookings(tenant_id, slot_start);

-- ── transfers ────────────────────────────────────────────────────────────
create table if not exists scarlett.transfers (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid references scarlett.calls(id) on delete set null,
  tenant_id text references scarlett.tenants(id) on delete cascade,
  reason    text,
  summary   text,
  to_number text,
  status    text,
  ts        timestamptz not null default now()
);
create index if not exists transfers_tenant_idx on scarlett.transfers(tenant_id, ts desc);

-- ── llm_usage — per-turn Anthropic token cost (live turns + summary) ──────
create table if not exists scarlett.llm_usage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references scarlett.tenants(id) on delete cascade,
  call_id            uuid references scarlett.calls(id) on delete set null,
  vapi_call_id       text,
  model              text not null,
  kind               text not null,            -- 'live' | 'summary'
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_cents         numeric not null default 0,
  ts                 timestamptz not null default now()
);
create index if not exists llm_usage_tenant_idx on scarlett.llm_usage(tenant_id, ts desc);
create index if not exists llm_usage_vapi_idx on scarlett.llm_usage(vapi_call_id);
alter table scarlett.llm_usage enable row level security;

-- ── portal_users — client-portal login emails, one tenant each ────────────
create table if not exists scarlett.portal_users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references scarlett.tenants(id) on delete cascade,
  email         text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists portal_users_email_uidx on scarlett.portal_users(lower(email));
create index if not exists portal_users_tenant_idx on scarlett.portal_users(tenant_id);

-- ── tenant_stats view (legacy; kept for back-compat) ──────────────────────
create or replace view scarlett.tenant_stats with (security_invoker = true) as
select
  t.id as tenant_id,
  count(c.id) filter (where c.created_at >= now() - interval '7 days')  as calls_7d,
  max(c.created_at)                                                     as last_call_at,
  count(c.id) filter (where c.created_at >= date_trunc('month', now())) as calls_mtd,
  coalesce(sum(c.duration_sec) filter
    (where c.created_at >= date_trunc('month', now())), 0)::int         as seconds_mtd,
  coalesce(sum(c.cost_cents) filter
    (where c.created_at >= date_trunc('month', now())), 0)::int         as cost_cents_mtd,
  (select count(*) from scarlett.leads l
    where l.tenant_id = t.id
      and l.created_at >= now() - interval '7 days')                    as leads_7d
from scarlett.tenants t
left join scarlett.calls c on c.tenant_id = t.id
group by t.id;

-- ── analytics RPCs ────────────────────────────────────────────────────────
-- search_path is pinned to scarlett so the unqualified table refs inside
-- resolve to scarlett.* regardless of who calls them.

create or replace function scarlett.tenant_activity_series(
  p_tenant_id text,
  p_start     timestamptz,
  p_bucket    text
) returns table (
  bucket         timestamptz,
  calls          bigint,
  seconds        bigint,
  leads          bigint,
  bookings       bigint,
  cost_cents     bigint,
  llm_cost_cents numeric
)
language plpgsql stable
set search_path = scarlett
as $$
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'bad bucket %', p_bucket;
  end if;
  return query
  with bounds as (
    select
      date_trunc(p_bucket, coalesce(
        p_start,
        (select min(c.created_at) from calls c where c.tenant_id = p_tenant_id),
        now()
      )) as start_at,
      date_trunc(p_bucket, now()) as end_at
  ),
  s as (
    select generate_series(
      (select start_at from bounds),
      (select end_at from bounds),
      ('1 ' || p_bucket)::interval
    ) as bucket
  )
  select
    s.bucket,
    count(c.id),
    coalesce(sum(c.duration_sec), 0)::bigint,
    (select count(*) from leads l
      where l.tenant_id = p_tenant_id
        and date_trunc(p_bucket, l.created_at) = s.bucket),
    (select count(*) from bookings b
      where b.tenant_id = p_tenant_id
        and date_trunc(p_bucket, b.created_at) = s.bucket),
    coalesce(sum(c.cost_cents), 0)::bigint,
    (select coalesce(sum(lu.cost_cents), 0) from llm_usage lu
      where lu.tenant_id = p_tenant_id
        and date_trunc(p_bucket, lu.ts) = s.bucket)
  from s
  left join calls c
    on c.tenant_id = p_tenant_id
   and date_trunc(p_bucket, c.created_at) = s.bucket
  group by s.bucket
  order by s.bucket;
end $$;

create or replace function scarlett.tenant_range_stats(
  p_tenant_id text,
  p_start     timestamptz
) returns table (
  calls          bigint,
  seconds        bigint,
  cost_cents     bigint,
  leads          bigint,
  bookings       bigint,
  transfers      bigint,
  llm_cost_cents numeric,
  last_call_at   timestamptz
)
language sql stable
set search_path = scarlett
as $$
  select
    (select count(*)                      from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select coalesce(sum(duration_sec),0) from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select coalesce(sum(cost_cents),0)   from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from leads     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from bookings  where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from transfers where tenant_id = p_tenant_id and (p_start is null or ts >= p_start)),
    (select coalesce(sum(cost_cents),0)   from llm_usage where tenant_id = p_tenant_id and (p_start is null or ts >= p_start)),
    (select max(created_at)               from calls     where tenant_id = p_tenant_id);
$$;

create or replace function scarlett.tenants_range_stats(
  p_start timestamptz
) returns table (
  tenant_id      text,
  calls          bigint,
  seconds        bigint,
  cost_cents     bigint,
  leads          bigint,
  bookings       bigint,
  llm_cost_cents numeric,
  last_call_at   timestamptz
)
language sql stable
set search_path = scarlett
as $$
  select
    t.id,
    count(c.id) filter (where p_start is null or c.created_at >= p_start),
    coalesce(sum(c.duration_sec) filter (where p_start is null or c.created_at >= p_start), 0)::bigint,
    coalesce(sum(c.cost_cents)   filter (where p_start is null or c.created_at >= p_start), 0)::bigint,
    (select count(*) from leads l
      where l.tenant_id = t.id and (p_start is null or l.created_at >= p_start)),
    (select count(*) from bookings b
      where b.tenant_id = t.id and (p_start is null or b.created_at >= p_start)),
    (select coalesce(sum(lu.cost_cents), 0) from llm_usage lu
      where lu.tenant_id = t.id and (p_start is null or lu.ts >= p_start)),
    max(c.created_at)
  from tenants t
  left join calls c on c.tenant_id = t.id
  group by t.id;
$$;

revoke execute on function scarlett.tenant_activity_series(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function scarlett.tenant_range_stats(text, timestamptz)           from public, anon, authenticated;
revoke execute on function scarlett.tenants_range_stats(timestamptz)                from public, anon, authenticated;

-- ── RLS: deny all; service_role bypasses it ───────────────────────────────
alter table scarlett.tenants      enable row level security;
alter table scarlett.calls        enable row level security;
alter table scarlett.transcripts  enable row level security;
alter table scarlett.leads        enable row level security;
alter table scarlett.bookings     enable row level security;
alter table scarlett.transfers    enable row level security;
alter table scarlett.portal_users enable row level security;

-- ── Privileges: the backend (service_role) owns the data ──────────────────
grant all privileges on all tables    in schema scarlett to service_role;
grant all privileges on all sequences in schema scarlett to service_role;
grant execute        on all functions in schema scarlett to service_role;
alter default privileges in schema scarlett grant all on tables    to service_role;
alter default privileges in schema scarlett grant all on sequences to service_role;
alter default privileges in schema scarlett grant execute on functions to service_role;

-- ── seed the Elenos tenant ────────────────────────────────────────────────
insert into scarlett.tenants (id, name, business_hours)
values ('elenos', 'Elenos', '{"mondayToFriday":{"open":"09:00","close":"18:00"}}'::jsonb)
on conflict (id) do nothing;
