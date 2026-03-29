import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("onboarded, two_factor_enabled")
          .eq("id", user.id)
          .single();

        if (!profile?.onboarded) {
          const onboardUrl = new URL(`${origin}/auth/onboard`);
          if (next !== "/app") onboardUrl.searchParams.set("next", next);
          return NextResponse.redirect(onboardUrl.toString());
        }

        if (profile?.two_factor_enabled) {
          return NextResponse.redirect(`${origin}/auth/verify-2fa`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=callback_failed`);
}
