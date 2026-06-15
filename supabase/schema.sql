-- Scarlett — Supabase schema.
-- Multi-tenant from day one: tenant_id on every table + RLS. Only the service
-- role (our backend) touches these tables, so RLS is "deny all" to anon/auth
-- and the service-role key bypasses RLS. When a client-facing dashboard is
-- added later, add per-tenant SELECT policies keyed to the authenticated user.
--
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ── tenants ──────────────────────────────────────────────────────────────
create table if not exists tenants (
  id               text primary key,                 -- matches config/<id>.tenant.json
  name             text not null,
  phone_number     text,                             -- the Twilio number Scarlett answers on
  vapi_assistant_id text,
  business_hours   jsonb,
  transfer_number  text,
  created_at       timestamptz not null default now()
);

-- ── calls ────────────────────────────────────────────────────────────────
create table if not exists calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id),
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
  tenant_id   text not null references tenants(id),
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
  tenant_id       text not null references tenants(id),
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
  tenant_id text references tenants(id),
  reason    text,
  summary   text,
  to_number text,
  status    text,                -- 'transferred' | 'callback_captured'
  ts        timestamptz not null default now()
);

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
