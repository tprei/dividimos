-- Linked expense mutations keep finalized room clients on the current bill.
CREATE FUNCTION public.invalidate_assignment_room_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_room_id uuid;
BEGIN
  IF NEW.current_version_no IS NOT DISTINCT FROM OLD.current_version_no
     AND NEW.status IS NOT DISTINCT FROM OLD.status
  THEN
    RETURN NEW;
  END IF;

  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE expense_id = NEW.id
    AND status = 'finalized'
  RETURNING id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    PERFORM public.broadcast_assignment_room(v_room_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignment_room_expense_realtime
AFTER UPDATE OF current_version_no, status ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_assignment_room_expense();

REVOKE ALL ON FUNCTION public.invalidate_assignment_room_expense()
  FROM PUBLIC, anon, authenticated;
