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

      const tokenData = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        onboard: needsOnboarding,
      });

      return new Response(
        `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Autenticado</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui;background:#F9F9FB;color:#09243f;text-align:center}
.done{font-size:18px;font-weight:600}p{color:#666;margin-top:8px}</style>
</head><body>
<div><div class="done">Pronto!</div><p>Pode fechar esta janela.</p></div>
<script>localStorage.setItem("__cap_auth",${JSON.stringify(tokenData)});</script>
</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
  }

  return Response.redirect(`${origin}/auth?error=callback_failed`);
}
