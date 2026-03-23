-- Bill participant invites with consent
-- Participants must accept before the bill can be finalized and Pix codes generated

CREATE TYPE bill_participant_status AS ENUM ('invited', 'accepted', 'declined');

ALTER TABLE bill_participants
  ADD COLUMN status bill_participant_status NOT NULL DEFAULT 'accepted',
  ADD COLUMN invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN responded_at TIMESTAMPTZ;

CREATE INDEX idx_bill_participants_user_status
  ON bill_participants(user_id, status);

CREATE POLICY "bill_participants_respond"
  ON bill_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (status IN ('accepted', 'declined'));

ALTER PUBLICATION supabase_realtime ADD TABLE bill_participants;
