-- STEP 2 — Secure the existing tables and turn on cloud sync.
-- ⚠️ DRAFT: do not run until the results of 01_check_security.sql have been
--    reviewed. It assumes the columns the app uses (user_id on the data tables,
--    id + plan + plan_expires_at on profiles).
--
-- Order matters: lock rows down (RLS + per-user policies) BEFORE granting the
-- browser roles access. Everything runs in one transaction — if any statement
-- fails, nothing changes.

begin;

-- ── 1. Row Level Security on every app table ───────────────────────────────
alter table public.profiles          enable row level security;
alter table public.workout_logs      enable row level security;
alter table public.personal_records  enable row level security;
alter table public.program_history   enable row level security;
alter table public.program_sessions  enable row level security;

-- ── 2. Per-user policies: you can only ever see and change your own rows ───
-- (Re-runnable: drops these named policies first. Other pre-existing policies
--  are NOT dropped — remove any over-broad ones flagged in the check step.)

drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "own profile delete" on public.profiles;
create policy "own profile select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own profile delete" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

do $$
declare t text;
begin
  foreach t in array array['workout_logs', 'personal_records', 'program_history', 'program_sessions'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- ── 3. Users can never change their own subscription plan ──────────────────
-- Only the server (service_role, e.g. a future Stripe webhook) may set it.
create or replace function public.protect_profile_plan()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.plan := 'free';
      new.plan_expires_at := null;
    else
      new.plan := old.plan;
      new.plan_expires_at := old.plan_expires_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_plan on public.profiles;
create trigger protect_profile_plan
  before insert or update on public.profiles
  for each row execute function public.protect_profile_plan();

-- ── 4. New table for resume-where-you-left-off (from schema.sql) ───────────
create table if not exists public.eatt_program_state (
    user_id     uuid not null references auth.users(id) on delete cascade,
    prog_id     text not null,
    name        text,
    page        text,
    inputs      jsonb,
    cursor      int,
    week        int,
    day         int,
    wave        int,
    cycle_count int,
    saved_at    bigint,
    updated_at  timestamptz not null default now(),
    primary key (user_id, prog_id)
);
alter table public.eatt_program_state enable row level security;

drop policy if exists "select own program state" on public.eatt_program_state;
drop policy if exists "insert own program state" on public.eatt_program_state;
drop policy if exists "update own program state" on public.eatt_program_state;
drop policy if exists "delete own program state" on public.eatt_program_state;
create policy "select own program state" on public.eatt_program_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own program state" on public.eatt_program_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own program state" on public.eatt_program_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own program state" on public.eatt_program_state for delete to authenticated using ((select auth.uid()) = user_id);

-- Dedupe key for synced logs
alter table public.workout_logs add column if not exists client_ts bigint;

-- ── 5. Only now: let signed-in users reach the tables (RLS still applies) ──
grant select, insert, update, delete on
  public.profiles, public.workout_logs, public.personal_records,
  public.program_history, public.program_sessions, public.eatt_program_state
  to authenticated;

-- Logged-out visitors get nothing.
revoke all on
  public.profiles, public.workout_logs, public.personal_records,
  public.program_history, public.program_sessions, public.eatt_program_state
  from anon;

commit;

-- Tell the API about the new table/column right away.
notify pgrst, 'reload schema';
