-- 0001 — Productize: DB-backed tenant config + per-tenant integration values.
-- Run in the Supabase SQL editor (idempotent).
--
-- After this migration the tenants row is the source of truth at runtime:
--   config  — the full TenantConfig JSON (was config/<id>.tenant.json)
--   columns — per-tenant integration values (were global env vars)
-- config/*.tenant.json remain as seed/template files only.

alter table tenants
  add column if not exists config               jsonb,
  add column if not exists status               text not null default 'active',  -- 'draft' | 'active' | 'paused'
  add column if not exists vapi_phone_number_id text,
  add column if not exists calendar_id          text,      -- Google Calendar id (calendar shared with the service account)
  add column if not exists discord_webhook_url  text,      -- per-client Discord channel webhook
  add column if not exists notify_phone         text,      -- SMS alert target (was FOUNDER_CELL)
  add column if not exists owner_numbers        text[] not null default '{}',  -- caller IDs that unlock founder mode
  add column if not exists updated_at           timestamptz not null default now();

-- Runtime tenant resolution keys: a Vapi assistant/number maps to exactly one tenant.
create unique index if not exists tenants_vapi_assistant_uidx
  on tenants(vapi_assistant_id) where vapi_assistant_id is not null;
create unique index if not exists tenants_vapi_phone_uidx
  on tenants(vapi_phone_number_id) where vapi_phone_number_id is not null;
