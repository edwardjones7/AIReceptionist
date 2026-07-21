-- 0004 — portal_users: maps a client login email to its tenant. One email →
-- one tenant (v1). Managed from /admin; read on every portal request by
-- requirePortalTenant() (lib/portal-auth.ts), so removing a row locks the
-- user out immediately even with a live Supabase Auth session.
-- Idempotent; run in the Supabase SQL editor.

create table if not exists portal_users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id) on delete cascade,
  email         text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists portal_users_email_uidx on portal_users(lower(email));
create index if not exists portal_users_tenant_idx on portal_users(tenant_id);

-- Service role only, like everything else.
alter table portal_users enable row level security;

-- Defense-in-depth (NOT enabled): if a browser-side Supabase client is ever
-- introduced, scope reads per tenant with policies like the below. Today the
-- anon key is used only for auth — data reads go through the service role
-- after a server-side tenant check — so these stay commented out.
--
-- create policy "portal reads own calls" on calls for select
--   to authenticated using (
--     tenant_id in (select tenant_id from portal_users
--                   where lower(email) = lower(auth.jwt()->>'email'))
--   );
