-- Server-side RPCs for DM conversation list performance.
--
-- Replaces two client-side hot paths that fetched all chat_messages
-- for every DM group and filtered in JS:
--   1. Conversation list preview (latest message per group)
--   2. Unread count badge (messages after last_read_at, per group)
--
-- Both functions are SECURITY INVOKER so RLS applies naturally —
-- callers only see rows they already have SELECT permission for.

-- ============================================================
-- 1. get_dm_previews — one row per group, the latest message
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dm_previews(p_group_ids uuid[])
RETURNS TABLE (
  group_id     uuid,
  content      text,
  message_type text,
  created_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (group_id)
    group_id,
    content,
    message_type::text,
    created_at
  FROM public.chat_messages
  WHERE group_id = ANY(p_group_ids)
  ORDER BY group_id, created_at DESC;
$$;

-- ============================================================
-- 2. get_unread_counts — unread messages per group for the caller
-- ============================================================
-- Only returns rows where unread_count > 0 so callers don't
-- need to filter. Groups with no read receipt are treated as
-- fully unread (COALESCE to -infinity).

CREATE OR REPLACE FUNCTION public.get_unread_counts(p_group_ids uuid[])
RETURNS TABLE (
  group_id     uuid,
  unread_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    cm.group_id,
    COUNT(*)::integer AS unread_count
  FROM public.chat_messages cm
  LEFT JOIN public.conversation_read_receipts crr
    ON crr.group_id = cm.group_id
   AND crr.user_id  = auth.uid()
  WHERE cm.group_id  = ANY(p_group_ids)
    AND cm.sender_id != auth.uid()
    AND cm.created_at > COALESCE(crr.last_read_at, '-infinity'::timestamptz)
  GROUP BY cm.group_id
  HAVING COUNT(*) > 0;
$$;
