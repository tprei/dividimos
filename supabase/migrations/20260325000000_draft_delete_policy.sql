-- Allow bill creators to delete their own draft bills
CREATE POLICY "creators_can_delete_drafts"
  ON public.bills
  FOR DELETE
  USING (
    creator_id = auth.uid()
    AND status = 'draft'
  );
