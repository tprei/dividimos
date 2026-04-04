import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

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

      const params = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (needsOnboarding) params.set("onboard", "1");
      const intentUri = `intent://auth/complete?${params}#Intent;scheme=dividimos;package=ai.dividimos.app;end`;
      return new Response(null, {
        status: 302,
        headers: { Location: intentUri },
      });
    }
  }

  return Response.redirect(`${origin}/auth?error=callback_failed`);
}
