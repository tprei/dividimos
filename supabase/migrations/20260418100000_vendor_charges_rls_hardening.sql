-- Vendor charges RLS hardening.
--
-- Tightens the invariants on vendor_charges so the two-phase
-- "create pending → confirm received" audit trail the UI promises
-- is enforced at the database level. Brings policy style in line
-- with the rls_hardening pass (vendor_charges_*, TO authenticated,
-- uppercase DDL).
--
-- Findings addressed:
--
-- [MEDIUM] UPDATE was unrestricted at the column level. A user
--   could revert status received → pending and re-confirm, or mutate
--   amount_cents / description / created_at / confirmed_at on their
--   own rows after the fact. No cross-user impact, but it defeats
--   the audit trail the "Recebido hoje" total and charges history
--   rely on. Fix: drop the UPDATE policy entirely and route
--   confirmation through confirm_vendor_charge (SECURITY DEFINER),
--   matching confirm_settlement elsewhere in the schema.
--
-- [MEDIUM] INSERT WITH CHECK only verified user_id = auth.uid().
--   A user could create a pre-confirmed row (status = 'received',
--   confirmed_at = <arbitrary timestamp>) in one shot, bypassing
--   the two-phase flow. Fix: require status = 'pending' and
--   confirmed_at IS NULL at insert time.
--
-- [LOW] Policy names and DDL style aligned with rls_hardening
--   conventions. TO authenticated clauses now explicit.
--
-- No DELETE policy is introduced: vendor charges are an audit
-- trail and must remain immutable from client code.

DROP POLICY IF EXISTS "Users can view own charges" ON public.vendor_charges;
DROP POLICY IF EXISTS "Users can insert own charges" ON public.vendor_charges;
DROP POLICY IF EXISTS "Users can update own charges" ON public.vendor_charges;

CREATE POLICY "vendor_charges_select" ON public.vendor_charges
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "vendor_charges_insert" ON public.vendor_charges
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND confirmed_at IS NULL
  );

CREATE OR REPLACE FUNCTION public.confirm_vendor_charge(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
    INTO v_charge
    FROM public.vendor_charges
   WHERE id = p_charge_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge_not_found: %', p_charge_id;
  END IF;

  IF v_charge.user_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the charge owner can confirm';
  END IF;

  IF v_charge.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status: charge is %, expected pending', v_charge.status;
  END IF;

  UPDATE public.vendor_charges
     SET status = 'received',
         confirmed_at = now()
   WHERE id = p_charge_id;
END;
$$;
