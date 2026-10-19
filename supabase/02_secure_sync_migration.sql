-- STEP 2 — Secure the existing tables and turn on cloud sync.
-- Revised 2026-10-19 after a live audit of the database (Supabase MCP, read-only):
--   * all 5 tables: RLS on, 0 rows, no grants to anon/authenticated
--   * every table had TWO policy sets: legacy "Users own …" (FOR ALL, role
--     public) and per-command <table>_select/insert/update/delete. The legacy
--     set is dropped here; the per-command set is kept (same names, recreated).
--   * idx_<table>_user_id indexes already exist, so none are added for user_id
--   * profiles.stripe_customer_id was user-writable, so it is now protected with the plan fields
--   * program_sessions could point at another user's program_history row
--
-- Order matters: lock rows down (RLS + per-user policies) BEFORE granting the
-- browser roles access. Everything runs in one transaction — if any statement
-- fails, nothing changes. Safe to re-run.

begin;

-- ── 1. Row Level Security on every app table ───────────────────────────────
alter table public.profiles          enable row level security;
alter table public.workout_logs      enable row level security;
alter table public.personal_records  enable row level security;
alter table public.program_history   enable row level security;
alter table public.program_sessions  enable row level security;

-- ── 2. Exactly one policy per command: you only see and change your own rows ─
-- Legacy FOR ALL policies (role public, auth.uid() re-evaluated per row).
drop policy if exists "Users own profiles"        on public.profiles;
drop policy if exists "Users own logs"            on public.workout_logs;
drop policy if exists "Users own PRs"             on public.personal_records;
drop policy if exists "Users own program history" on public.program_history;

-- profiles is keyed on id (= auth.users.id)
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete on public.profiles for delete to authenticated using ((select auth.uid()) = id);

-- data tables are keyed on user_id; policy names are <table>_<command>
do $$
declare t text;
begin
  foreach t in array array['workout_logs', 'personal_records', 'program_history', 'program_sessions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete', t);
  end loop;
end $$;

-- ── 3. Users can never change their own billing fields ─────────────────────
-- Browser roles (anon / authenticated, which includes anonymous users) can't
-- touch plan, plan_expires_at or stripe_customer_id; only server roles
-- (service_role, e.g. a future Stripe webhook, or the dashboard) can. Checks
-- current_user rather than the deprecated auth.role().
create or replace function public.protect_profile_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.plan := 'free';
      new.plan_expires_at := null;
      new.stripe_customer_id := null;
    else
      new.plan := old.plan;
      new.plan_expires_at := old.plan_expires_at;
      new.stripe_customer_id := old.stripe_customer_id;
    end if;
  end if;
  return new;
end $$;

-- Trigger-only function: nobody needs to call it through the API.
revoke execute on function public.protect_profile_plan() from public, anon, authenticated;

drop trigger if exists protect_profile_plan on public.profiles;
create trigger protect_profile_plan
  before insert or update on public.profiles
  for each row execute function public.protect_profile_plan();

-- Deleting an auth user should remove their profile too (other tables already cascade).
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- ── 4. program_sessions integrity ──────────────────────────────────────────
-- Every session belongs to a user, and may only reference that same user's
-- program_history row (composite FK). Tables are empty, so these are safe.
alter table public.program_sessions alter column user_id set not null;

-- Drop the FK before the unique key it depends on (keeps this re-runnable).
alter table public.program_sessions drop constraint if exists program_sessions_program_history_id_fkey;

alter table public.program_history drop constraint if exists program_history_id_user_id_key;
alter table public.program_history
  add constraint program_history_id_user_id_key unique (id, user_id);

alter table public.program_sessions
  add constraint program_sessions_program_history_id_fkey
  foreign key (program_history_id, user_id)
  references public.program_history (id, user_id) on delete cascade;

-- Covering index for that FK (advisor: unindexed_foreign_keys).
create index if not exists idx_program_sessions_program_history_id
  on public.program_sessions (program_history_id, user_id);

-- ── 5. New table for resume-where-you-left-off (from schema.sql) ───────────
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

drop policy if exists eatt_program_state_select on public.eatt_program_state;
drop policy if exists eatt_program_state_insert on public.eatt_program_state;
drop policy if exists eatt_program_state_update on public.eatt_program_state;
drop policy if exists eatt_program_state_delete on public.eatt_program_state;
create policy eatt_program_state_select on public.eatt_program_state for select to authenticated using ((select auth.uid()) = user_id);
create policy eatt_program_state_insert on public.eatt_program_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy eatt_program_state_update on public.eatt_program_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy eatt_program_state_delete on public.eatt_program_state for delete to authenticated using ((select auth.uid()) = user_id);
-- (user_id is covered by the primary key, so no extra index.)

-- Dedupe key for synced logs
alter table public.workout_logs add column if not exists client_ts bigint;

-- ── 6. Only now: let signed-in users reach the tables (RLS still applies) ──
-- Start from nothing so default privileges (TRUNCATE, TRIGGER, ...) don't linger.
revoke all on
  public.profiles, public.workout_logs, public.personal_records,
  public.program_history, public.program_sessions, public.eatt_program_state
  from authenticated;
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
