-- EATT cloud sync schema — additions to your EXISTING Supabase project
-- (https://paecbytkqkhevexmfdmq.supabase.co). This does NOT touch your
-- existing profiles / personal_records / program_history / program_sessions
-- tables. Run once in Dashboard → SQL Editor → New query.
--
-- Also required (Dashboard → Authentication → Sign In / Providers):
--   Enable "Allow anonymous sign-ins"

-- ── 1. In-progress program state (resume-where-you-left-off) ───────────────
-- One row per user per program: the exact setup inputs (1RMs, wave count,
-- etc.) plus a cursor into the generated program, so any device can rebuild
-- the identical program and jump back to the same spot.
create table if not exists eatt_program_state (
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

alter table eatt_program_state enable row level security;

create policy "select own program state" on eatt_program_state
    for select using (auth.uid() = user_id);
create policy "insert own program state" on eatt_program_state
    for insert with check (auth.uid() = user_id);
create policy "update own program state" on eatt_program_state
    for update using (auth.uid() = user_id);
create policy "delete own program state" on eatt_program_state
    for delete using (auth.uid() = user_id);

-- ── 2. Reuse your existing workout_logs table for completed sessions ───────
-- Adds one nullable column so the app can reliably tell "have I already
-- synced this exact log entry" apart across devices/reloads, without
-- touching any of your existing 6 rows (they'll just have client_ts = null,
-- which the app already accounts for).
alter table workout_logs add column if not exists client_ts bigint;
