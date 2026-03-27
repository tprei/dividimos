-- Seed test users for local development
-- These users are created via Supabase Auth admin API, which triggers
-- the handle_new_user() function to auto-create public.users rows.

-- Insert test users into auth.users (the trigger creates public.users rows)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'alice@test.pixwise.local',
  '$2b$10$Zqg7YqulB1zYL80MCW43TO.6T6Y1NikGDfeIfHGhSDacoQC4uJ0Xa',
  now(), '{"full_name": "Alice Teste"}'::jsonb,
  now(), now(), '', '', '', ''
), (
  '00000000-0000-0000-0000-000000000000',
  'b2222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated',
  'bob@test.pixwise.local',
  '$2b$10$Zqg7YqulB1zYL80MCW43TO.6T6Y1NikGDfeIfHGhSDacoQC4uJ0Xa',
  now(), '{"full_name": "Bob Teste"}'::jsonb,
  now(), now(), '', '', '', ''
), (
  '00000000-0000-0000-0000-000000000000',
  'c3333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated',
  'carol@test.pixwise.local',
  '$2b$10$Zqg7YqulB1zYL80MCW43TO.6T6Y1NikGDfeIfHGhSDacoQC4uJ0Xa',
  now(), '{"full_name": "Carol Teste"}'::jsonb,
  now(), now(), '', '', '', ''
);

-- Also create identity records so password login works
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  '{"sub": "a1111111-1111-1111-1111-111111111111", "email": "alice@test.pixwise.local"}'::jsonb,
  'email', 'a1111111-1111-1111-1111-111111111111',
  now(), now(), now()
), (
  'b2222222-2222-2222-2222-222222222222',
  'b2222222-2222-2222-2222-222222222222',
  '{"sub": "b2222222-2222-2222-2222-222222222222", "email": "bob@test.pixwise.local"}'::jsonb,
  'email', 'b2222222-2222-2222-2222-222222222222',
  now(), now(), now()
), (
  'c3333333-3333-3333-3333-333333333333',
  'c3333333-3333-3333-3333-333333333333',
  '{"sub": "c3333333-3333-3333-3333-333333333333", "email": "carol@test.pixwise.local"}'::jsonb,
  'email', 'c3333333-3333-3333-3333-333333333333',
  now(), now(), now()
);

-- Mark seed users as onboarded with test Pix keys
UPDATE public.users SET
  onboarded = true,
  pix_key_encrypted = '',
  pix_key_hint = '***@teste',
  pix_key_type = 'email'
WHERE email LIKE '%@test.pixwise.local';
