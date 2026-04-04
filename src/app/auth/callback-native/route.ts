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
      const deepLink = `dividimos://auth/complete?${params}`;
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>window.location.href=${JSON.stringify(deepLink)};</script></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
  }

  return Response.redirect(`${origin}/auth?error=callback_failed`);
}
