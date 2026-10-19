-- STEP 0 — Base tables, for a NEW empty Supabase project only (e.g. staging).
-- Recreates the prod tables as they were before 02_secure_sync_migration.sql
-- (snapshot of prod, 2026-10-19). Run this first, then 02.
-- Do NOT run on prod: the tables already exist there.

begin;

create table if not exists public.profiles (
    id                 uuid primary key references auth.users(id),
    display_name       text,
    age                integer,
    experience_level   text,
    primary_goal       text,
    units              text default 'lbs',
    plan               text default 'free',
    plan_expires_at    timestamptz,
    stripe_customer_id text,
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

create table if not exists public.workout_logs (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users(id) on delete cascade,
    date         date not null,
    program_name text,
    session_name text,
    exercises    jsonb default '[]'::jsonb,
    notes        text,
    created_at   timestamptz default now()
);

create table if not exists public.personal_records (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    lift_name  text not null,
    weight     numeric not null,
    date       date,
    created_at timestamptz default now(),
    unique (user_id, lift_name)
);

create table if not exists public.program_history (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users(id) on delete cascade,
    program_name text not null,
    started_at   date,
    completed_at date,
    notes        text,
    created_at   timestamptz default now()
);

create table if not exists public.program_sessions (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid references auth.users(id) on delete cascade,
    program_history_id uuid references public.program_history(id) on delete cascade,
    week               integer,
    day                integer,
    session_label      text,
    exercises          jsonb default '[]'::jsonb,
    completed_at       timestamptz,
    notes              text,
    created_at         timestamptz default now()
);

create index if not exists idx_workout_logs_user_id     on public.workout_logs (user_id);
create index if not exists idx_personal_records_user_id on public.personal_records (user_id);
create index if not exists idx_program_history_user_id  on public.program_history (user_id);
create index if not exists idx_program_sessions_user_id on public.program_sessions (user_id);

-- Lock everything down until 02 adds per-user policies and grants.
alter table public.profiles         enable row level security;
alter table public.workout_logs     enable row level security;
alter table public.personal_records enable row level security;
alter table public.program_history  enable row level security;
alter table public.program_sessions enable row level security;

revoke all on
  public.profiles, public.workout_logs, public.personal_records,
  public.program_history, public.program_sessions
  from anon, authenticated;

commit;
