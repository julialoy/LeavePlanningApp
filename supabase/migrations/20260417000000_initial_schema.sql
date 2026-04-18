-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- User profiles (one per auth.users row)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Leave types defined by each user (e.g. Vacation, Sick, Personal)
create table public.leave_types (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#3B82F6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- required to support composite FKs in leave_policies, leave_balances, leave_entries
  unique (id, user_id)
);

-- Case-insensitive, whitespace-trimmed uniqueness: prevents "Vacation", "vacation", and " Vacation" coexisting for the same user
create unique index leave_types_user_id_name_ci on public.leave_types (user_id, lower(trim(name)));

-- How each leave type is earned
create table public.leave_policies (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  leave_type_id       uuid not null,
  accrual_type        text not null check (accrual_type in ('accrual', 'lump_sum')),
  -- accrual fields
  accrual_rate        numeric check (accrual_rate >= 0),
  accrual_frequency   text check (accrual_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'yearly')),
  -- lump sum fields
  lump_sum_amount     numeric check (lump_sum_amount > 0),
  lump_sum_month      integer check (lump_sum_month between 1 and 12),
  lump_sum_day        integer check (lump_sum_day between 1 and 31),
  -- month and day must be set together or both left null
  check ((lump_sum_month is null) = (lump_sum_day is null)),
  -- balance rules
  max_balance         numeric check (max_balance >= 0),
  carry_over_limit    numeric check (carry_over_limit >= 0),
  -- carry-over limit cannot exceed the maximum balance when both are set
  check (carry_over_limit is null or max_balance is null or carry_over_limit <= max_balance),
  unit                text not null default 'hours' check (unit in ('hours', 'days')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, leave_type_id),
  foreign key (leave_type_id, user_id) references public.leave_types (id, user_id) on delete cascade,
  -- Ensure required fields are present and opposing fields are null for each accrual type.
  -- accrual: rate and frequency required; lump sum fields must be absent.
  -- lump_sum: amount required; accrual rate and frequency must be absent.
  check (
    (
      accrual_type = 'accrual'
      and accrual_rate is not null
      and accrual_frequency is not null
      and lump_sum_amount is null
      and lump_sum_month is null
      and lump_sum_day is null
    )
    or
    (
      accrual_type = 'lump_sum'
      and lump_sum_amount is not null
      and accrual_rate is null
      and accrual_frequency is null
    )
  ),
  -- Validate that lump_sum_day is a real day in lump_sum_month.
  -- Uses a non-leap year (2001) so February is capped at 28 — Feb 29 is intentionally
  -- disallowed to avoid ambiguity on non-leap years. Lump sum policies on Feb 29
  -- are considered an unsupported edge case.
  -- make_date(2001, lump_sum_month, 1) gets the first of the month, and the interval
  -- arithmetic finds the last day of that month to use as the upper bound.
  check (
    lump_sum_month is null or lump_sum_day is null or
    lump_sum_day <= extract(day from (make_date(2001, lump_sum_month, 1) + interval '1 month - 1 day'))
  )
);

-- Current leave balances per user per leave type
create table public.leave_balances (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  leave_type_id   uuid not null,
  balance         numeric not null default 0,
  as_of_date      date not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, leave_type_id),
  foreign key (leave_type_id, user_id) references public.leave_types (id, user_id) on delete cascade
);

-- Individual leave entries
-- status lifecycle: planned -> scheduled -> in_progress -> taken
--   planned:     user is considering taking leave, not yet requested
--   scheduled:   leave approved by employer, not yet started
--   in_progress: leave has started but not yet completed (e.g. day 3 of a 10-day vacation)
--   taken:       leave fully completed
create table public.leave_entries (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  leave_type_id   uuid not null,
  start_date      date not null,
  end_date        date not null,
  amount          numeric not null,
  status          text not null default 'planned' check (status in ('planned', 'scheduled', 'in_progress', 'taken')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (leave_type_id, user_id) references public.leave_types (id, user_id) on delete cascade
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Calendar view queries filter by user and date range
create index leave_entries_user_dates on public.leave_entries (user_id, start_date, end_date);

-- Dashboard and list queries filter by user and status
create index leave_entries_user_status on public.leave_entries (user_id, status);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.leave_types
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.leave_policies
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.leave_balances
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.leave_entries
  for each row execute function public.set_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN UP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles       enable row level security;
alter table public.leave_types    enable row level security;
alter table public.leave_policies enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_entries  enable row level security;

-- profiles: users can only read and update their own row
create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- leave_types: full access to own rows only
create policy "leave_types: select own" on public.leave_types
  for select using (auth.uid() = user_id);

create policy "leave_types: insert own" on public.leave_types
  for insert with check (auth.uid() = user_id);

create policy "leave_types: update own" on public.leave_types
  for update using (auth.uid() = user_id);

create policy "leave_types: delete own" on public.leave_types
  for delete using (auth.uid() = user_id);

-- leave_policies: full access to own rows only
create policy "leave_policies: select own" on public.leave_policies
  for select using (auth.uid() = user_id);

create policy "leave_policies: insert own" on public.leave_policies
  for insert with check (auth.uid() = user_id);

create policy "leave_policies: update own" on public.leave_policies
  for update using (auth.uid() = user_id);

create policy "leave_policies: delete own" on public.leave_policies
  for delete using (auth.uid() = user_id);

-- leave_balances: full access to own rows only
create policy "leave_balances: select own" on public.leave_balances
  for select using (auth.uid() = user_id);

create policy "leave_balances: insert own" on public.leave_balances
  for insert with check (auth.uid() = user_id);

create policy "leave_balances: update own" on public.leave_balances
  for update using (auth.uid() = user_id);

create policy "leave_balances: delete own" on public.leave_balances
  for delete using (auth.uid() = user_id);

-- leave_entries: full access to own rows only
create policy "leave_entries: select own" on public.leave_entries
  for select using (auth.uid() = user_id);

create policy "leave_entries: insert own" on public.leave_entries
  for insert with check (auth.uid() = user_id);

create policy "leave_entries: update own" on public.leave_entries
  for update using (auth.uid() = user_id);

create policy "leave_entries: delete own" on public.leave_entries
  for delete using (auth.uid() = user_id);
