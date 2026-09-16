-- Topic ids are matched as uuids: a malformed topic yields a clean denial
-- instead of an "invalid input syntax for type uuid" during policy evaluation.
CREATE FUNCTION public.current_user_is_member(p_group_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND status = 'accepted'
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_is_member(uuid) TO authenticated;

CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(
        realtime.topic()
        FROM '^user:([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
      )::uuid = auth.uid()
    ELSE
      public.current_user_is_member(
        substring(
          realtime.topic()
          FROM '^(?:group|chat):([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
        )::uuid
      )
  END
);

CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_handle TEXT;
  email_local TEXT;
  user_name TEXT;
  suffix INT := 0;
BEGIN
  email_local := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9_]', '', 'g'));

  IF char_length(email_local) < 3 THEN
    email_local := email_local || 'user';
  END IF;
  IF char_length(email_local) > 30 THEN
    email_local := left(email_local, 30);
  END IF;

  generated_handle := email_local;

  WHILE EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle) LOOP
    suffix := suffix + 1;
    generated_handle := left(email_local, 30 - char_length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;

  user_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user'
  );
  user_name := left(user_name, 80);

  INSERT INTO public.users (id, email, handle, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    generated_handle,
    user_name,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public;
