SET lock_timeout = '5s';

-- A group avatar is either an emoji from the fixed client palette or a photo
-- id, never both, and never on a DM. The emoji check matches exact text; the
-- beach and airplane entries include their U+FE0F variation selector.
ALTER TABLE public.groups
  ADD COLUMN avatar_emoji text,
  ADD COLUMN avatar_photo_id uuid;

ALTER TABLE public.groups
  ADD CONSTRAINT groups_avatar_exclusive_check
  CHECK (avatar_emoji IS NULL OR avatar_photo_id IS NULL)
  NOT VALID;

-- Allowed glyphs, in order: U+1F3E0, U+1F37B, U+1F355, U+1F3D6 U+FE0F,
-- U+2708 U+FE0F, U+26BD, U+1F389, U+1F431.
ALTER TABLE public.groups
  ADD CONSTRAINT groups_avatar_emoji_check
  CHECK (
    avatar_emoji IS NULL OR
    avatar_emoji IN ('🏠', '🍻', '🍕', '🏖️', '✈️', '⚽', '🎉', '🐱')
  )
  NOT VALID;

ALTER TABLE public.groups
  ADD CONSTRAINT groups_dm_no_avatar_check
  CHECK (kind = 'group' OR (avatar_emoji IS NULL AND avatar_photo_id IS NULL))
  NOT VALID;

ALTER TABLE public.groups VALIDATE CONSTRAINT groups_avatar_exclusive_check;
ALTER TABLE public.groups VALIDATE CONSTRAINT groups_avatar_emoji_check;
ALTER TABLE public.groups VALIDATE CONSTRAINT groups_dm_no_avatar_check;
