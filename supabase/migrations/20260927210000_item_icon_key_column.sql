SET lock_timeout = '5s';

-- supersedes: public.assignment_room_items.icon introduced 20260927140100
ALTER TABLE public.assignment_room_items
  ALTER COLUMN icon TYPE text USING icon::text;

ALTER TABLE public.assignment_room_items
  ADD CONSTRAINT assignment_room_items_icon_key
  CHECK (icon ~ '^[a-z][a-z0-9_]{0,31}$') NOT VALID;
