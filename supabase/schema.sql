-- Scarlett — Supabase schema.
-- Multi-tenant from day one: tenant_id on every table + RLS. Only the service
-- role (our backend) touches these tables, so RLS is "deny all" to anon/auth
-- and the service-role key bypasses RLS. When a client-facing dashboard is
-- added later, add per-tenant SELECT policies keyed to the authenticated user.
--
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ── tenants ──────────────────────────────────────────────────────────────
-- The source of truth at runtime: config (full TenantConfig JSON) + per-tenant
-- integration values. config/*.tenant.json are seed/template files only.
create table if not exists tenants (
  id                   text primary key,             -- slug; seed templates live in config/<id>.tenant.json
  name                 text not null,
  status               text not null default 'active', -- 'draft' | 'active' | 'paused'
  config               jsonb,                        -- the full TenantConfig (validated by lib/config-schema.ts)
  phone_number         text,                         -- the number Scarlett answers on (E.164)
  vapi_assistant_id    text,
  vapi_phone_number_id text,
  business_hours       jsonb,
  calendar_id          text,                         -- Google Calendar shared with the service account
  discord_webhook_url  text,                         -- per-client Discord channel webhook
  notify_phone         text,                         -- SMS alert target
  owner_numbers        text[] not null default '{}', -- caller IDs that unlock founder mode
  transfer_number      text,
  last_preflight       jsonb,                        -- latest integration-check report (lib/preflight.ts)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Runtime tenant resolution keys: a Vapi assistant/number maps to one tenant.
create unique index if not exists tenants_vapi_assistant_uidx
  on tenants(vapi_assistant_id) where vapi_assistant_id is not null;
create unique index if not exists tenants_vapi_phone_uidx
  on tenants(vapi_phone_number_id) where vapi_phone_number_id is not null;

-- ── calls ────────────────────────────────────────────────────────────────
create table if not exists calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id) on delete cascade,
  vapi_call_id  text unique,
  caller_number text,
  started_at    timestamptz,
  ended_at      timestamptz,
  duration_sec  integer,
  outcome       text,            -- e.g. 'booked' | 'lead' | 'transferred' | 'answered' | 'missed'
  summary       text,
  recording_url text,
  cost_cents    integer,
  created_at    timestamptz not null default now()
);
create index if not exists calls_tenant_idx on calls(tenant_id, created_at desc);

-- ── transcripts ──────────────────────────────────────────────────────────
create table if not exists transcripts (
  id       uuid primary key default gen_random_uuid(),
  call_id  uuid not null references calls(id) on delete cascade,
  role     text not null,        -- 'user' | 'assistant' | 'system' | 'tool'
  text     text not null,
  ts       timestamptz not null default now()
);
create index if not exists transcripts_call_idx on transcripts(call_id, ts);

-- ── leads ────────────────────────────────────────────────────────────────
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references tenants(id) on delete cascade,
  call_id     uuid references calls(id) on delete set null,
  name        text,
  phone       text,
  email       text,
  intent      text,             -- what they want, short
  details     text,
  qualified   boolean default false,
  status      text default 'new',
  created_at  timestamptz not null default now()
);
create index if not exists leads_tenant_idx on leads(tenant_id, created_at desc);

-- ── bookings ─────────────────────────────────────────────────────────────
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  call_id         uuid references calls(id) on delete set null,
  type            text not null default 'discovery_call', -- 'discovery_call' | 'job'
  name            text,
  phone           text,
  email           text,
  slot_start      timestamptz,
  slot_end        timestamptz,
  gcal_event_id   text,
  status          text default 'confirmed',
  created_at      timestamptz not null default now()
);
create index if not exists bookings_tenant_idx on bookings(tenant_id, slot_start);

-- ── transfers ────────────────────────────────────────────────────────────
create table if not exists transfers (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid references calls(id) on delete set null,
  tenant_id text references tenants(id) on delete cascade,
  reason    text,
  summary   text,
  to_number text,
  status    text,                -- 'transferred' | 'callback_captured'
  ts        timestamptz not null default now()
);
create index if not exists transfers_tenant_idx on transfers(tenant_id, ts desc);

-- ── tenant_stats — per-tenant rollups for the admin dashboard ─────────────
-- One query for the tenant list and usage sections. Month boundary is UTC.
create or replace view tenant_stats with (security_invoker = true) as
select
  t.id as tenant_id,
  count(c.id) filter (where c.created_at >= now() - interval '7 days')  as calls_7d,
  max(c.created_at)                                                     as last_call_at,
  count(c.id) filter (where c.created_at >= date_trunc('month', now())) as calls_mtd,
  coalesce(sum(c.duration_sec) filter
    (where c.created_at >= date_trunc('month', now())), 0)::int         as seconds_mtd,
  coalesce(sum(c.cost_cents) filter
    (where c.created_at >= date_trunc('month', now())), 0)::int         as cost_cents_mtd,
  (select count(*) from leads l
    where l.tenant_id = t.id
      and l.created_at >= now() - interval '7 days')                    as leads_7d
from tenants t
left join calls c on c.tenant_id = t.id
group by t.id;

-- ── portal_users — client-portal login emails, one tenant each ────────────
-- Managed from /admin; checked on every portal request, so deleting a row
-- locks the user out immediately even with a live Supabase Auth session.
create table if not exists portal_users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id) on delete cascade,
  email         text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists portal_users_email_uidx on portal_users(lower(email));
create index if not exists portal_users_tenant_idx on portal_users(tenant_id);
alter table portal_users enable row level security;

-- ── analytics RPCs — range-scoped totals + zero-filled series ─────────────
-- Called only by the backend (service role) via db().rpc(...). UTC buckets.

create or replace function tenant_activity_series(
  p_tenant_id text,
  p_start     timestamptz,
  p_bucket    text
) returns table (
  bucket     timestamptz,
  calls      bigint,
  seconds    bigint,
  leads      bigint,
  bookings   bigint,
  cost_cents bigint
)
language plpgsql stable as $$
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
    coalesce(sum(c.cost_cents), 0)::bigint
  from s
  left join calls c
    on c.tenant_id = p_tenant_id
   and date_trunc(p_bucket, c.created_at) = s.bucket
  group by s.bucket
  order by s.bucket;
end $$;

create or replace function tenant_range_stats(
  p_tenant_id text,
  p_start     timestamptz
) returns table (
  calls        bigint,
  seconds      bigint,
  cost_cents   bigint,
  leads        bigint,
  bookings     bigint,
  transfers    bigint,
  last_call_at timestamptz
)
language sql stable as $$
  select
    (select count(*)                      from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select coalesce(sum(duration_sec),0) from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select coalesce(sum(cost_cents),0)   from calls     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from leads     where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from bookings  where tenant_id = p_tenant_id and (p_start is null or created_at >= p_start)),
    (select count(*)                      from transfers where tenant_id = p_tenant_id and (p_start is null or ts >= p_start)),
    (select max(created_at)               from calls     where tenant_id = p_tenant_id);
$$;

create or replace function tenants_range_stats(
  p_start timestamptz
) returns table (
  tenant_id    text,
  calls        bigint,
  seconds      bigint,
  cost_cents   bigint,
  leads        bigint,
  bookings     bigint,
  last_call_at timestamptz
)
language sql stable as $$
  select
    t.id,
    count(c.id) filter (where p_start is null or c.created_at >= p_start),
    coalesce(sum(c.duration_sec) filter (where p_start is null or c.created_at >= p_start), 0)::bigint,
    coalesce(sum(c.cost_cents)   filter (where p_start is null or c.created_at >= p_start), 0)::bigint,
    (select count(*) from leads l
      where l.tenant_id = t.id and (p_start is null or l.created_at >= p_start)),
    (select count(*) from bookings b
      where b.tenant_id = t.id and (p_start is null or b.created_at >= p_start)),
    max(c.created_at)
  from tenants t
  left join calls c on c.tenant_id = t.id
  group by t.id;
$$;

revoke execute on function tenant_activity_series(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function tenant_range_stats(text, timestamptz)           from public, anon, authenticated;
revoke execute on function tenants_range_stats(timestamptz)                from public, anon, authenticated;

-- ── RLS: lock everything down; service role bypasses RLS. ─────────────────
alter table tenants     enable row level security;
alter table calls       enable row level security;
alter table transcripts enable row level security;
alter table leads       enable row level security;
alter table bookings    enable row level security;
alter table transfers   enable row level security;
-- No policies => no access for anon/authenticated. Service-role key (backend
-- only) bypasses RLS. Add per-tenant SELECT policies when a dashboard exists.

-- ── seed the Elenos tenant (edit phone/assistant id after provisioning) ───
insert into tenants (id, name, business_hours)
values ('elenos', 'Elenos', '{"mondayToFriday":{"open":"09:00","close":"18:00"}}'::jsonb)
on conflict (id) do nothing;
