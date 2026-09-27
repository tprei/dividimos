-- Announcing an existing-group assignment room becomes a ledger event so the
-- host's action reaches every accepted member with one "room opened" push.
-- A new enum value cannot be used in the transaction that adds it, so it
-- ships alone; the function that emits it lands in 20260926120100.
ALTER TYPE public.event_kind ADD VALUE 'assignment_room_opened';
