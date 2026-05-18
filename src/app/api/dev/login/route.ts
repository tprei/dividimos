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
 * Only available when:
 *   - NODE_ENV === "development" or "test"
 *   - DEV_LOGIN_SECRET env var is set
 *   - Request carries x-dev-login-secret header matching DEV_LOGIN_SECRET
 * Only accepts @test.dividimos.local email addresses.
 *
 * Body: { email: string, name?: string, handle?: string }
 *   - email: creates user if not found, then signs in (e.g. "alice@test.dividimos.local")
 *   - name: optional display name to set on the user profile
 *   - handle: optional @handle to set on the user profile
 *
 * Returns: { success, userId, redirect }
 */
export async function POST(request: Request) {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    return NextResponse.json(
      { error: "not_available" },
      { status: 404 },
    );
  }

  const secret = process.env.DEV_LOGIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "not_available" },
      { status: 404 },
    );
  }

  const provided = request.headers.get("x-dev-login-secret");
  if (provided !== secret) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawEmail = (body as { email?: string; name?: string; handle?: string }).email ?? "";
  const email = rawEmail.toLowerCase().trim();
  const { name: profileName, handle: profileHandle } = body as {
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

  if (!email.endsWith("@test.dividimos.local")) {
    return NextResponse.json(
      { error: "Only @test.dividimos.local emails are allowed" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    let userId: string;

    const { data: existingRow } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    const user = existingRow ?? null;

    if (user) {
      userId = user.id as string;
    } else {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: profileName ?? "" },
        });

      if (createError || !created.user) {
        console.error("[dev/login] createUser error:", createError);
        return NextResponse.json(
          { error: "Failed to create dev user" },
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
      console.error("[dev/login] generateLink error:", linkError);
      return NextResponse.json(
        { error: "Failed to generate session" },
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
      console.error("[dev/login] verifyOtp error:", verifyError);
      return NextResponse.json(
        { error: "Failed to authenticate dev user" },
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
        console.error("[dev/login] profile upsert error:", upsertError);
        return NextResponse.json(
          { error: "Failed to set up dev user profile" },
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
    });
  } catch (err) {
    console.error("[dev/login] unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to authenticate dev user" },
      { status: 500 },
    );
  }
}
