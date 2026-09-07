import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirect } from "@/lib/safe-redirect";
import { evaluateServerFinancialGate } from "@/lib/financial-compatibility";

const PUBLIC_PATHS = ["/", "/demo", "/auth", "/auth/callback", "/api/dev/login", "/claim", "/join", "/.well-known", "/u", "/manutencao"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")),
  );
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (isPublicPath(request.nextUrl.pathname)) {
      return NextResponse.next({ request });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname) && pathname !== "/auth" && pathname !== "/") {
    return supabaseResponse;
  }

  const { data, error } = await supabase.auth.getClaims();
  const user = error || !data ? null : { id: data.claims.sub };

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Enforce maintenance/schema compatibility BEFORE any protected server
  // component renders. A client-side gate alone cannot prevent a server
  // component's own data fetch from running (and its result being
  // serialized into the RSC payload) — this redirect runs upstream of
  // that render entirely, so an incompatible/maintenance window can never
  // let a financial page's server-side fetch execute at all.
  if (user && !isPublicPath(pathname)) {
    const gate = evaluateServerFinancialGate();
    if (!gate.compatible) {
      const url = request.nextUrl.clone();
      url.pathname = "/manutencao";
      url.search = `?reason=${encodeURIComponent(gate.issue.code)}`;
      return NextResponse.redirect(url);
    }
  }

  if (user && (pathname === "/auth" || pathname === "/")) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const redirectTo = safeRedirect(nextParam);
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!pathname.startsWith("/app")) {
    supabaseResponse.headers.set("Cache-Control", "private, no-store");
  }

  return supabaseResponse;
}
