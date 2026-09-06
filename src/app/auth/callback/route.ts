import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";
import { decodeMe } from "@/lib/ledger/decode";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirect(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (!claimsError && claimsData) {
        const { data: profile } = await supabase.rpc("get_my_profile");
        const decoded = decodeMe(profile);
        if (!decoded.ok || !decoded.value.onboarded) {
          const onboardUrl = new URL(`${origin}/auth/onboard`);
          if (next !== "/app") onboardUrl.searchParams.set("next", next);
          return NextResponse.redirect(onboardUrl.toString());
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=callback_failed`);
}
