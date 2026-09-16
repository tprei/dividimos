import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirect(searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        const continueUrl = new URL(`${origin}/auth/continue`);
        continueUrl.searchParams.set("next", next);
        return NextResponse.redirect(continueUrl.toString());
      }
    } catch {
      // Keep code exchange failures separate from profile resolution failures.
    }
  }

  const failUrl = new URL("/auth", origin);
  failUrl.searchParams.set("error", "callback_failed");
  if (next && next !== "/") failUrl.searchParams.set("next", next);
  return NextResponse.redirect(failUrl.toString());
}
