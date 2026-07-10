-- Remove legacy DDS/Exclusive tables from the reused Supabase database.
--
-- The investment portfolio MVP currently owns only:
-- - public.profiles
-- - public.families
-- - public.family_members
--
-- Supabase system schemas such as auth, storage, realtime, vault, net and
-- supabase_functions must stay intact.

drop table if exists public.import_job_file cascade;
drop table if exists public.import_job cascade;
drop table if exists public.fct_liability_snapshot cascade;
drop table if exists public.fct_liability_movement cascade;
drop table if exists public.fct_cash_out cascade;
drop table if exists public.fct_cash_in cascade;
drop table if exists public.fct_balance_snapshot cascade;
drop table if exists public.dim_liability_party cascade;
drop table if exists public.dim_liability_instrument cascade;
drop table if exists public.dim_income_article cascade;
drop table if exists public.dim_expense_code cascade;
drop table if exists public.dim_entity cascade;
drop table if exists public.dim_bank cascade;
drop table if exists public.dim_account cascade;
drop table if exists public.app_config cascade;
