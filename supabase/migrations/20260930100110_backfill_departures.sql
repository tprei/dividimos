-- Backfill departure markers for members who left or were removed before
-- the departures table existed. group_events is the stored evidence; pairs
-- with no event are exactly the pairs the old guard already covered (no
-- membership row at all), so nothing is invented here. Safe to re-run.

INSERT INTO public.group_member_departures (group_id, user_id, departed_at)
SELECT DISTINCT ON (e.group_id, e.subject_user_id)
  e.group_id,
  e.subject_user_id,
  e.created_at
FROM public.group_events e
WHERE e.kind IN ('member_left', 'member_removed')
  AND e.subject_user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.groups g WHERE g.id = e.group_id)
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.subject_user_id)
ON CONFLICT (group_id, user_id) DO NOTHING;
