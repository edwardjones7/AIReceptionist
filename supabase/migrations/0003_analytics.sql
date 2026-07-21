-- 0003 — analytics RPCs for the dashboard: range-scoped totals + zero-filled
-- time series. Called only by the backend (service role) via db().rpc(...).
-- Buckets and range boundaries are UTC, matching the tenant_stats convention.
-- Idempotent; run in the Supabase SQL editor.

-- Zero-filled activity buckets for one tenant. p_start null = all-time
-- (starts at the tenant's first call). p_bucket: 'day' | 'week' | 'month'.
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

-- Totals for one tenant over a range. p_start null = all-time.
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

-- Range totals for every tenant in one query — the admin tenant list.
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

-- Backend-only: these run with the service role; nothing else may call them.
revoke execute on function tenant_activity_series(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function tenant_range_stats(text, timestamptz)           from public, anon, authenticated;
revoke execute on function tenants_range_stats(timestamptz)                from public, anon, authenticated;
