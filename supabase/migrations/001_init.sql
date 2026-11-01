-- Expense Tracker: initial schema. Idempotent where practical. RLS is enabled on EVERY table.


-- ---------------------------------------------------------------- profiles & settings
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme_mode text not null default 'system' check (theme_mode in ('system', 'light', 'dark')),
  accent_hex text not null default '#006A6A',
  currency text not null default 'PKR',
  locale text not null default 'en-PK',
  date_format text not null default 'EEE, d MMM',
  week_start smallint not null default 1 check (week_start between 1 and 7),
  timezone text not null default 'Asia/Karachi',
  remember_last jsonb not null default '{"category":true,"bank":true,"payment_mode":true,"need_want":true,"income_source":true}'::jsonb,
  trash_retention_days int not null default 30 check (trash_retention_days between 1 and 3650),
  sheet jsonb,
  updated_at timestamptz not null default now()
);

-- Encrypted app-side (AES-256-GCM). ciphertext = base64(iv).base64(tag).base64(data)
-- RLS on, NO policies: only the service role (server) can touch it.
create table if not exists public.secrets (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------- user managed lists
create table if not exists public.options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bank', 'payment_mode', 'category', 'income_source')),
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  color text,
  icon text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);
create index if not exists options_user_kind_idx on public.options (user_id, kind);

-- ---------------------------------------------------------------- transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (length(trim(name)) > 0),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_on date not null,
  category_id uuid references public.options (id),
  bank_id uuid references public.options (id),
  payment_mode_id uuid references public.options (id),
  income_source_id uuid references public.options (id),
  need_want text check (need_want in ('need', 'want')),
  notes text,
  deleted_at timestamptz,
  sheet_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tx_user_date_idx on public.transactions (user_id, occurred_on desc);
create index if not exists tx_user_deleted_idx on public.transactions (user_id, deleted_at);
create index if not exists tx_user_kind_created_idx on public.transactions (user_id, kind, created_at desc);
create index if not exists tx_user_category_idx on public.transactions (user_id, category_id);

-- ---------------------------------------------------------------- templates
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (length(trim(name)) > 0),
  behavior text not null default 'fill' check (behavior in ('fill', 'instant')),
  payload jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists templates_user_kind_idx on public.templates (user_id, kind, sort_order);

-- ---------------------------------------------------------------- google sheet outbox (server only)
create table if not exists public.sync_outbox (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists outbox_due_idx on public.sync_outbox (user_id, next_attempt_at);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.secrets enable row level security;
alter table public.options enable row level security;
alter table public.transactions enable row level security;
alter table public.templates enable row level security;
alter table public.sync_outbox enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists settings_own on public.user_settings;
create policy settings_own on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists options_own on public.options;
create policy options_own on public.options for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists tx_own on public.transactions;
create policy tx_own on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists templates_own on public.templates;
create policy templates_own on public.templates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- secrets and sync_outbox: intentionally no policies (service role only)

-- ---------------------------------------------------------------- triggers
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tx_set_updated_at on public.transactions;
create trigger tx_set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.user_settings;
create trigger settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Enqueue a Google Sheet sync whenever a transaction changes (only if a sheet is configured).
create or replace function public.enqueue_sheet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  tid uuid;
  has_sheet boolean;
begin
  if tg_op = 'DELETE' then
    uid := old.user_id; tid := old.id;
  else
    uid := new.user_id; tid := new.id;
  end if;

  -- ignore updates that only touch bookkeeping columns (avoids a sync loop)
  if tg_op = 'UPDATE' and
     (to_jsonb(new) - 'sheet_synced_at' - 'updated_at') = (to_jsonb(old) - 'sheet_synced_at' - 'updated_at') then
    return null;
  end if;

  select (sheet is not null and coalesce(sheet ->> 'spreadsheetId', '') <> '')
    into has_sheet from public.user_settings where user_id = uid;

  if coalesce(has_sheet, false) then
    insert into public.sync_outbox (user_id, transaction_id, op)
    values (uid, tid, case when tg_op = 'DELETE' then 'delete' else 'upsert' end);
  end if;
  return null;
end $$;

drop trigger if exists tx_enqueue_sheet_sync on public.transactions;
create trigger tx_enqueue_sheet_sync after insert or update or delete on public.transactions
  for each row execute function public.enqueue_sheet_sync();

-- ---------------------------------------------------------------- analytics
create or replace function public.bucket_start(d date, gran text, ws int default 1)
returns date language sql immutable as $$
  select case gran
    when 'week' then (date_trunc('week', (d + ((8 - ws) % 7))::timestamp) - make_interval(days => (8 - ws) % 7))::date
    when 'month' then date_trunc('month', d::timestamp)::date
    when 'year' then date_trunc('year', d::timestamp)::date
    else d
  end
$$;

-- All aggregation happens here (security invoker => RLS still applies).
create or replace function public.insights(
  p_from date,
  p_to date,
  p_gran text default 'day',
  p_kind text default null,
  p_category uuid default null,
  p_bank uuid default null,
  p_mode uuid default null,
  p_need_want text default null,
  p_source uuid default null,
  p_min numeric default null,
  p_max numeric default null,
  p_q text default null,
  p_week_start int default 1
) returns jsonb
language sql stable security invoker set search_path = public as $$
with f as (
  select t.id, t.kind, t.name, t.amount, t.occurred_on, t.category_id, t.bank_id,
         t.payment_mode_id, t.income_source_id, t.need_want
  from public.transactions t
  where t.user_id = auth.uid()
    and t.deleted_at is null
    and t.occurred_on between p_from and p_to
    and (p_kind is null or p_kind = '' or t.kind = p_kind)
    and (p_category is null or t.category_id = p_category)
    and (p_bank is null or t.bank_id = p_bank)
    and (p_mode is null or t.payment_mode_id = p_mode)
    and (p_need_want is null or p_need_want = '' or t.need_want = p_need_want)
    and (p_source is null or t.income_source_id = p_source)
    and (p_min is null or t.amount >= p_min)
    and (p_max is null or t.amount <= p_max)
    and (p_q is null or p_q = '' or t.name ilike '%' || p_q || '%' or coalesce(t.notes, '') ilike '%' || p_q || '%')
)
select jsonb_build_object(
  'totals', (
    select jsonb_build_object(
      'spent', coalesce(sum(amount) filter (where kind = 'expense'), 0),
      'income', coalesce(sum(amount) filter (where kind = 'income'), 0),
      'count', count(*),
      'expense_count', count(*) filter (where kind = 'expense'),
      'biggest', (select to_jsonb(x) from (select name, amount from f where kind = 'expense' order by amount desc limit 1) x)
    ) from f
  ),
  'series', coalesce((
    select jsonb_agg(r order by r.bucket) from (
      select public.bucket_start(occurred_on, p_gran, p_week_start) as bucket,
             coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense,
             coalesce(sum(amount) filter (where kind = 'income'), 0) as income,
             count(*) as count
      from f group by 1
    ) r
  ), '[]'::jsonb),
  'monthly', coalesce((
    select jsonb_agg(r order by r.bucket) from (
      select public.bucket_start(occurred_on, 'month') as bucket,
             coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense,
             coalesce(sum(amount) filter (where kind = 'income'), 0) as income
      from f group by 1
    ) r
  ), '[]'::jsonb),
  'by_category', coalesce((
    select jsonb_agg(r order by r.total desc) from (
      select o.id, coalesce(o.name, 'Uncategorized') as name, o.color, sum(f.amount) as total, count(*) as count
      from f left join public.options o on o.id = f.category_id
      where f.kind = 'expense' group by o.id, o.name, o.color
    ) r
  ), '[]'::jsonb),
  'by_source', coalesce((
    select jsonb_agg(r order by r.total desc) from (
      select o.id, coalesce(o.name, 'Unspecified') as name, o.color, sum(f.amount) as total, count(*) as count
      from f left join public.options o on o.id = f.income_source_id
      where f.kind = 'income' group by o.id, o.name, o.color
    ) r
  ), '[]'::jsonb),
  'by_bank', coalesce((
    select jsonb_agg(r order by (r.expense + r.income) desc) from (
      select o.id, coalesce(o.name, 'Unspecified') as name,
             coalesce(sum(f.amount) filter (where f.kind = 'expense'), 0) as expense,
             coalesce(sum(f.amount) filter (where f.kind = 'income'), 0) as income
      from f left join public.options o on o.id = f.bank_id group by o.id, o.name
    ) r
  ), '[]'::jsonb),
  'by_mode', coalesce((
    select jsonb_agg(r order by (r.expense + r.income) desc) from (
      select o.id, coalesce(o.name, 'Unspecified') as name,
             coalesce(sum(f.amount) filter (where f.kind = 'expense'), 0) as expense,
             coalesce(sum(f.amount) filter (where f.kind = 'income'), 0) as income
      from f left join public.options o on o.id = f.payment_mode_id group by o.id, o.name
    ) r
  ), '[]'::jsonb),
  'need_want', coalesce((
    select jsonb_agg(r) from (
      select coalesce(need_want, 'unspecified') as key, sum(amount) as total, count(*) as count
      from f where kind = 'expense' group by 1
    ) r
  ), '[]'::jsonb),
  'nw_series', coalesce((
    select jsonb_agg(r order by r.bucket) from (
      select public.bucket_start(occurred_on, p_gran, p_week_start) as bucket,
             coalesce(sum(amount) filter (where need_want = 'need'), 0) as need,
             coalesce(sum(amount) filter (where need_want = 'want'), 0) as want,
             coalesce(sum(amount) filter (where need_want is null), 0) as unspecified
      from f where kind = 'expense' group by 1
    ) r
  ), '[]'::jsonb),
  'top', coalesce((
    select jsonb_agg(r) from (
      select f.id, f.name, f.amount, f.occurred_on, o.name as category
      from f left join public.options o on o.id = f.category_id
      where f.kind = 'expense' order by f.amount desc, f.occurred_on desc limit 10
    ) r
  ), '[]'::jsonb),
  'daily', coalesce((
    select jsonb_agg(r order by r.day) from (
      select occurred_on as day, sum(amount) as total from f where kind = 'expense' group by 1
    ) r
  ), '[]'::jsonb),
  'dow', coalesce((
    select jsonb_agg(r order by r.dow) from (
      select extract(isodow from occurred_on)::int as dow, sum(amount) as total, count(distinct occurred_on) as days
      from f where kind = 'expense' group by 1
    ) r
  ), '[]'::jsonb)
);
$$;

revoke all on function public.insights(date, date, text, text, uuid, uuid, uuid, text, uuid, numeric, numeric, text, int) from public, anon;
grant execute on function public.insights(date, date, text, text, uuid, uuid, uuid, text, uuid, numeric, numeric, text, int) to authenticated;

-- ---------------------------------------------------------------- RLS audit helper (run before launch)
-- select * from public.rls_audit();   -- must return zero rows
create or replace function public.rls_audit() returns table (table_name text)
language sql stable security invoker set search_path = public as $$
  select c.relname::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname <> '_migrations';
$$;
revoke all on function public.rls_audit() from public, anon, authenticated;
