SET lock_timeout = '5s';

ALTER TABLE public.group_members ADD COLUMN archived_at timestamptz;

ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_archived_requires_accepted
  CHECK (archived_at IS NULL OR status = 'accepted') NOT VALID;
