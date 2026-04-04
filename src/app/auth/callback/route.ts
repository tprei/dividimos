import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirect(searchParams.get("next"));
  const isNative = searchParams.get("native") === "1";

  if (code) {
    const supabase = await createClient();
    const { data: sessionData, error } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!error && sessionData.session) {
      const { session } = sessionData;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      let needsOnboarding = false;
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("onboarded")
          .eq("id", user.id)
          .single();
        needsOnboarding = !profile?.onboarded;
      }

      if (isNative) {
        const params = new URLSearchParams({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (needsOnboarding) params.set("onboard", "1");
        return NextResponse.redirect(`dividimos://auth/complete?${params}`);
      }

      if (needsOnboarding) {
        const onboardUrl = new URL(`${origin}/auth/onboard`);
        if (next !== "/app") onboardUrl.searchParams.set("next", next);
        return NextResponse.redirect(onboardUrl.toString());
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=callback_failed`);
}
