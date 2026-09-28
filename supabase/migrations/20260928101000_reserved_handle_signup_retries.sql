CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  generated_handle TEXT;
  base TEXT;
  raw_name TEXT;
  user_name TEXT;
  attempt INT := 0;
  v_constraint TEXT;
BEGIN
  raw_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', '')
  );

  IF raw_name IS NULL THEN
    base := 'usuario';
  ELSE
    base := left(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(
                lower(raw_name),
                'àáâãäåçèéêëìíîïñòóôõöùúûüýÿŉāăąćĉċčďēĕėęěĝğġģĥĩīĭįĵķĺļľńņňōŏőŕŗřśŝşšţťũūŭůűųŵŷźżž',
                'aaaaaaceeeeiiiinooooouuuuyynaaaccccdeeeeegggghiiiijklllnnnooorrrssssttuuuuuuwyzzz'
              ),
              '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '_', 'g'
            ),
            '[^a-z0-9_]', '', 'g'
          ),
          '_+', '_', 'g'
        ),
        '^_+|_+$', '', 'g'
      ),
      30
    );
  END IF;

  IF char_length(base) < 3 THEN
    base := 'usuario';
  END IF;
  IF public.is_reserved_handle(base) THEN
    base := 'usuario';
  END IF;

  user_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user'
  );
  user_name := left(user_name, 80);

  LOOP
    IF generated_handle IS NULL THEN
      IF attempt = 0 THEN
        generated_handle := base;
      ELSIF attempt <= 20 THEN
        generated_handle := left(base, 26) || (1000 + floor(random() * 9000))::int::text;
      ELSE
        generated_handle := left(base, 22) || (100000 + floor(random() * 900000))::int::text;
      END IF;
      attempt := attempt + 1;
      IF EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle)
         OR public.is_reserved_handle(generated_handle) THEN
        generated_handle := NULL;
      END IF;
    END IF;
    IF generated_handle IS NULL THEN
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.users (id, email, handle, name, avatar_url)
      VALUES (
        NEW.id,
        NEW.email,
        generated_handle,
        user_name,
        NEW.raw_user_meta_data->>'avatar_url'
      );
      RETURN NEW;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint <> 'users_handle_key' THEN
          RAISE;
        END IF;
        generated_handle := NULL;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
