CREATE POLICY "group_members_self_decline"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid()
    AND status = 'invited'
  );
