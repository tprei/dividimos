-- Let group members see payments linked to their group's settlements.
-- The existing payments_select policy (party-only) stays — this ORs with it.

CREATE POLICY "payments_select_group_members"
  ON public.payments FOR SELECT
  USING (
    group_settlement_id IS NOT NULL
    AND group_settlement_id IN (
      SELECT id FROM public.group_settlements
      WHERE group_id IN (SELECT public.my_group_ids())
    )
  );
