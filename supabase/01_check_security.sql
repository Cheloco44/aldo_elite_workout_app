-- STEP 1 — READ-ONLY security check. Changes nothing.
-- Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Run each block (or all at once) and copy the results back to Claude.

-- A. Is Row Level Security ON for every table? (rowsecurity must be true)
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- B. Existing policies. Any policy with qual = 'true' (or no user check) lets
--    every signed-in user see every row — including anonymous users.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- C. What the browser roles are allowed to touch at all.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- D. Columns, so the migration matches your real tables.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
