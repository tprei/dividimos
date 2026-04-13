import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * POST /api/dev/login
 *
 * Programmatic login for development/testing — agents can authenticate
 * with a single HTTP request instead of navigating the UI.
 *
 * Only available when NEXT_PUBLIC_DEV_LOGIN_ENABLED=true.
 *
 * Body: { email: string, name?: string, handle?: string }
 *   - email: creates user if not found, then signs in (e.g. "alice@test.dividimos.local")
 *   - name: optional display name to set on the user profile
 *   - handle: optional @handle to set on the user profile
 *
 * Returns: { success, userId, redirect, cookies }
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Dev login is disabled in production" },
      { status: 404 },
    );
  }

  if (process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Dev login is only available in test mode" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { email, name: profileName, handle: profileHandle } = body as {
    email?: string;
    name?: string;
    handle?: string;
  };

  if (!email) {
    return NextResponse.json(
      { error: "Provide 'email'" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    let userId: string;

    const { data: existing } = await admin.auth.admin.listUsers();
    const user = existing?.users.find((u) => u.email === email);

    if (user) {
      userId = user.id;
    } else {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: profileName ?? "" },
        });

      if (createError || !created.user) {
        return NextResponse.json(
          { error: `Failed to create user: ${createError?.message}` },
          { status: 500 },
        );
      }
      userId = created.user.id;
    }

    // Generate a magic link and verify it to create a session
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkError || !linkData) {
      return NextResponse.json(
        { error: `Failed to generate session: ${linkError?.message}` },
        { status: 500 },
      );
    }

    const linkUrl = new URL(linkData.properties.action_link);
    const tokenHash =
      linkUrl.searchParams.get("token_hash") ??
      linkUrl.searchParams.get("token");
    if (!tokenHash) {
      return NextResponse.json(
        { error: "Failed to generate session: token missing" },
        { status: 500 },
      );
    }

    // Create a server client that can set cookies on the response
    const cookieStore = await cookies();
    const responseCookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }> = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
              responseCookies.push({ name, value, options });
            }
          },
        },
      },
    );

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

    if (verifyError) {
      return NextResponse.json(
        { error: `Session verification failed: ${verifyError.message}` },
        { status: 500 },
      );
    }

    // If name/handle provided, ensure profile exists and is up to date
    if (profileName || profileHandle) {
      const { data: existingProfile } = await admin
        .from("users")
        .select("id, onboarded")
        .eq("id", userId)
        .single();

      const { error: upsertError } = existingProfile
        ? await admin
            .from("users")
            .update({
              ...(profileName ? { name: profileName } : {}),
              ...(profileHandle ? { handle: profileHandle } : {}),
              onboarded: true,
            })
            .eq("id", userId)
        : await admin.from("users").insert({
            id: userId,
            name: profileName || "",
            handle: profileHandle || userId.slice(0, 8),
            pix_key_encrypted: "",
            onboarded: true,
          });

      if (upsertError) {
        return NextResponse.json(
          { error: `Profile setup failed: ${upsertError.message}` },
          { status: 500 },
        );
      }
    }

    // Check if user needs onboarding
    const { data: profile } = await supabase
      .from("users")
      .select("onboarded")
      .eq("id", userId)
      .single();

    const redirect = profile?.onboarded ? "/app" : "/auth/onboard";

    return NextResponse.json({
      success: true,
      userId,
      redirect,
      cookies: responseCookies.map((c) => ({
        name: c.name,
        value: c.value,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
