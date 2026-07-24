-- 0005 — LLM token-cost tracking. Records per-turn Anthropic usage (Haiku live
-- turns + the Sonnet summary) so the dashboard can show model cost alongside
-- Vapi's telephony cost. Written best-effort from lib/llm-cost.ts.
--
-- IMPORTANT: the LIVE Elenos DB runs the `scarlett` schema — run
-- supabase/migrations/0005_llm_usage_scarlett.sql there. This file is the
-- public-schema equivalent for standalone installs. Idempotent.

create table if not exists llm_usage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references tenants(id) on delete cascade,
  call_id            uuid references calls(id) on delete set null,
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
create index if not exists llm_usage_tenant_idx on llm_usage(tenant_id, ts desc);
create index if not exists llm_usage_vapi_idx on llm_usage(vapi_call_id);
alter table llm_usage enable row level security;

-- Return-type changes require drop+recreate (create-or-replace can't add columns).
drop function if exists tenant_activity_series(text, timestamptz, text);
create function tenant_activity_series(
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

drop function if exists tenant_range_stats(text, timestamptz);
create function tenant_range_stats(
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
language sql stable as $$
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

drop function if exists tenants_range_stats(timestamptz);
create function tenants_range_stats(
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
    (select coalesce(sum(lu.cost_cents), 0) from llm_usage lu
      where lu.tenant_id = t.id and (p_start is null or lu.ts >= p_start)),
    max(c.created_at)
  from tenants t
  left join calls c on c.tenant_id = t.id
  group by t.id;
$$;

revoke execute on function tenant_activity_series(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function tenant_range_stats(text, timestamptz)           from public, anon, authenticated;
revoke execute on function tenants_range_stats(timestamptz)                from public, anon, authenticated;
