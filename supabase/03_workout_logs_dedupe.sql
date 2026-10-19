-- STEP 3 — One row per logged workout. The app upserts on (user_id, client_ts),
-- so a retry, a second tab, or a sync race can't insert the same workout twice.
-- Safe to re-run. Run on staging first, then prod.

begin;

-- Remove existing duplicates (keep the earliest row of each pair).
delete from public.workout_logs a
using public.workout_logs b
where a.user_id = b.user_id
  and a.client_ts = b.client_ts
  and a.client_ts is not null
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists workout_logs_user_client_ts_key
  on public.workout_logs (user_id, client_ts);

commit;

notify pgrst, 'reload schema';
