-- 0002 — Dashboard completeness: cascade deletes, tenant_stats view, preflight.
-- Run in the Supabase SQL editor (idempotent).

-- ── Cascade deletes tenants → children (enables Delete tenant in /admin) ──
-- Constraint names are the Postgres defaults from schema.sql's inline
-- `references tenants(id)`.
alter table calls
  drop constraint if exists calls_tenant_id_fkey,
  add constraint calls_tenant_id_fkey
    foreign key (tenant_id) references tenants(id) on delete cascade;
alter table leads
  drop constraint if exists leads_tenant_id_fkey,
  add constraint leads_tenant_id_fkey
    foreign key (tenant_id) references tenants(id) on delete cascade;
alter table bookings
  drop constraint if exists bookings_tenant_id_fkey,
  add constraint bookings_tenant_id_fkey
    foreign key (tenant_id) references tenants(id) on delete cascade;
alter table transfers
  drop constraint if exists transfers_tenant_id_fkey,
  add constraint transfers_tenant_id_fkey
    foreign key (tenant_id) references tenants(id) on delete cascade;

-- ── Transfers listing index ────────────────────────────────────────────────
create index if not exists transfers_tenant_idx on transfers(tenant_id, ts desc);

-- ── Per-tenant stats: one query for the tenant list + usage rollups ───────
-- security_invoker: no definer privileges; the service-role client bypasses
-- RLS anyway, and anon/auth roles have no grants on the underlying tables.
-- Month boundary is UTC.
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

-- ── Preflight report storage (integration checks run from /admin) ─────────
alter table tenants add column if not exists last_preflight jsonb;
