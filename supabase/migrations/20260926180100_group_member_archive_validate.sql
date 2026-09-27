SET lock_timeout = '5s';

ALTER TABLE public.group_members VALIDATE CONSTRAINT group_members_archived_requires_accepted;
