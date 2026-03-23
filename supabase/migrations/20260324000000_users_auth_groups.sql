-- Migration: Users auth + groups + Pix encryption
-- Adds Google OAuth support, handle system, encrypted Pix keys, and groups with mutual confirmation

-- 1. Users table evolution
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pix_key_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users RENAME COLUMN pix_key TO pix_key_encrypted;

ALTER TABLE users ADD CONSTRAINT handle_format
  CHECK (handle ~ '^[a-z0-9][a-z0-9._]{0,18}[a-z0-9]$');
ALTER TABLE users ADD CONSTRAINT handle_length
  CHECK (char_length(handle) >= 3 AND char_length(handle) <= 20);

-- Link users.id to Supabase Auth
ALTER TABLE users ADD CONSTRAINT users_auth_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Auto-create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
DECLARE
  generated_handle TEXT;
  email_local TEXT;
  suffix INT := 0;
BEGIN
  email_local := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9._]', '', 'g'));

  IF char_length(email_local) < 3 THEN
    email_local := email_local || 'user';
  END IF;
  IF char_length(email_local) > 20 THEN
    email_local := left(email_local, 20);
  END IF;

  -- Trim trailing dots/underscores for constraint compliance
  email_local := regexp_replace(email_local, '[._]+$', '');
  IF char_length(email_local) < 3 THEN
    email_local := email_local || 'user';
  END IF;

  generated_handle := email_local;

  WHILE EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle) LOOP
    suffix := suffix + 1;
    generated_handle := left(email_local, 20 - char_length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;

  INSERT INTO public.users (id, email, handle, name, avatar_url, pix_key_encrypted, pix_key_hint, pix_key_type, onboarded)
  VALUES (
    NEW.id,
    NEW.email,
    generated_handle,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    '',
    '',
    'email',
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Groups
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE group_member_status AS ENUM ('invited', 'accepted');

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status group_member_status NOT NULL DEFAULT 'invited',
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_groups_creator ON groups(creator_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_group_members_status ON group_members(status);

-- 4. Safe public profile view (never exposes pix_key_encrypted, email, phone)
CREATE VIEW public.user_profiles AS
SELECT id, handle, name, avatar_url
FROM public.users;

GRANT SELECT ON public.user_profiles TO authenticated;

-- 5. RLS on new tables
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Groups: creators and accepted members can read
CREATE POLICY "group_select"
  ON groups FOR SELECT
  USING (
    creator_id = auth.uid()
    OR id IN (
      SELECT group_id FROM group_members
      WHERE user_id = auth.uid() AND status = 'accepted'
    )
  );

CREATE POLICY "group_insert"
  ON groups FOR INSERT
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "group_update"
  ON groups FOR UPDATE
  USING (creator_id = auth.uid());

CREATE POLICY "group_delete"
  ON groups FOR DELETE
  USING (creator_id = auth.uid());

-- Group members: visible to all members of the same group
CREATE POLICY "group_members_select"
  ON group_members FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
    OR group_id IN (
      SELECT id FROM groups WHERE creator_id = auth.uid()
    )
  );

-- Only group creators and accepted members can invite
CREATE POLICY "group_members_insert"
  ON group_members FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
      OR group_id IN (
        SELECT group_id FROM group_members
        WHERE user_id = auth.uid() AND status = 'accepted'
      )
    )
  );

-- Users can accept their own invites
CREATE POLICY "group_members_accept"
  ON group_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (status = 'accepted');

-- Creators can remove members
CREATE POLICY "group_members_delete"
  ON group_members FOR DELETE
  USING (
    group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
  );

-- 6. Update users RLS to allow handle lookups by authenticated users
DROP POLICY IF EXISTS "Users can read own profile" ON users;

-- Users can read their own full profile
CREATE POLICY "users_read_own"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Authenticated users can look up other users by exact handle (via user_profiles view)
-- The view restricts which columns are visible

CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Allow inserting own profile (for the trigger which runs as SECURITY DEFINER)
-- The trigger already handles this, but explicit policy for direct onboarding updates

-- 7. Realtime for groups
ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
