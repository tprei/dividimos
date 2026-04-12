-- Migration: Track per-user read state for DM conversations.
-- Stores when a user last read messages in each group, enabling
-- unread count badges on the conversations list and nav tab.

-- ============================================================
-- 1. Read receipts table
-- ============================================================
-- One row per (user, group). Updated via UPSERT when the user
-- opens a conversation. Unread count = messages created after
-- last_read_at for that group.

CREATE TABLE conversation_read_receipts (
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

-- ============================================================
-- 2. Indexes
-- ============================================================
-- Primary query: fetch all read receipts for a user (to compute
-- unread counts across all DM conversations).

CREATE INDEX idx_conversation_read_receipts_user
  ON conversation_read_receipts(user_id);

-- ============================================================
-- 3. Row Level Security
-- ============================================================

ALTER TABLE conversation_read_receipts ENABLE ROW LEVEL SECURITY;

-- SELECT: users can only read their own receipts
CREATE POLICY conversation_read_receipts_select
  ON conversation_read_receipts
  FOR SELECT USING (user_id = auth.uid());

-- INSERT: users can only create receipts for themselves in their groups
CREATE POLICY conversation_read_receipts_insert
  ON conversation_read_receipts
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND group_id IN (SELECT my_group_ids())
  );

-- UPDATE: users can only update their own receipts
CREATE POLICY conversation_read_receipts_update
  ON conversation_read_receipts
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: users can only delete their own receipts
CREATE POLICY conversation_read_receipts_delete
  ON conversation_read_receipts
  FOR DELETE USING (user_id = auth.uid());
