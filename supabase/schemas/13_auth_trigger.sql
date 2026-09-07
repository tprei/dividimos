CREATE OR REPLACE FUNCTION public.handle_new_user()
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
