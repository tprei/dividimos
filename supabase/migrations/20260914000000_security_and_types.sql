CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS guest_credentials;

CREATE TYPE public.group_kind AS ENUM ('group', 'dm');
CREATE TYPE public.member_status AS ENUM ('invited', 'accepted');
CREATE TYPE public.expense_type AS ENUM ('itemized', 'single_amount');
CREATE TYPE public.expense_status AS ENUM ('active', 'deleted');
CREATE TYPE public.participant_kind AS ENUM ('user', 'guest');
CREATE TYPE public.settlement_status AS ENUM ('confirmed', 'voided');
CREATE TYPE public.pix_key_type AS ENUM ('cpf', 'email', 'phone', 'random');
CREATE TYPE public.event_kind AS ENUM (
  'expense_created', 'expense_edited', 'expense_deleted', 'expense_restored',
  'settlement_recorded', 'settlement_voided',
  'member_invited', 'member_joined', 'member_left', 'member_removed',
  'guest_claimed', 'nudge'
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM public, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA guest_credentials FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA guest_credentials TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA guest_credentials TO service_role;
