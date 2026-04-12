-- Migration: Add DM flag to groups + chat_messages table
-- Supports 1-on-1 conversation threads with text and system messages.
-- System messages link to expenses/settlements created within the DM.

-- ============================================================
-- 1. Add is_dm flag to groups
-- ============================================================
-- DM groups are two-person groups used for 1-on-1 conversations.
-- Regular group queries must filter on is_dm = false to avoid
-- polluting the groups tab.

ALTER TABLE groups ADD COLUMN is_dm BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_groups_is_dm ON groups(is_dm);

-- ============================================================
-- 2. Chat message type enum
-- ============================================================

CREATE TYPE chat_message_type AS ENUM ('text', 'system_expense', 'system_settlement');

-- ============================================================
-- 3. Chat messages table
-- ============================================================
-- Each message belongs to a group (DM or regular, though initially
-- only DM groups will have chat UIs). System messages reference
-- the expense or settlement they represent.

CREATE TABLE chat_messages (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid              NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id       uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type    chat_message_type NOT NULL DEFAULT 'text',
  content         text              NOT NULL DEFAULT '',
  expense_id      uuid              REFERENCES expenses(id) ON DELETE SET NULL,
  settlement_id   uuid              REFERENCES settlements(id) ON DELETE SET NULL,
  created_at      timestamptz       NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Indexes for chat_messages
-- ============================================================
-- Primary query pattern: fetch messages for a group ordered by time (paginated).
-- Secondary: filter by sender, look up by linked expense/settlement.

CREATE INDEX idx_chat_messages_group_created
  ON chat_messages(group_id, created_at DESC);

CREATE INDEX idx_chat_messages_sender
  ON chat_messages(sender_id);

CREATE INDEX idx_chat_messages_expense
  ON chat_messages(expense_id)
  WHERE expense_id IS NOT NULL;

CREATE INDEX idx_chat_messages_settlement
  ON chat_messages(settlement_id)
  WHERE settlement_id IS NOT NULL;

-- ============================================================
-- 5. Row Level Security
-- ============================================================

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: accepted group members can read messages
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT USING (group_id IN (SELECT my_group_ids()));

-- INSERT: accepted group members can send messages in their groups.
-- sender_id must match the authenticated user.
CREATE POLICY chat_messages_insert ON chat_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND group_id IN (SELECT my_group_ids())
  );

-- UPDATE: only the sender can edit their own text messages
CREATE POLICY chat_messages_update ON chat_messages
  FOR UPDATE USING (
    sender_id = auth.uid()
    AND message_type = 'text'
  )
  WITH CHECK (sender_id = auth.uid());

-- DELETE: only the sender can delete their own text messages
CREATE POLICY chat_messages_delete ON chat_messages
  FOR DELETE USING (
    sender_id = auth.uid()
    AND message_type = 'text'
  );

-- ============================================================
-- 6. Realtime
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
