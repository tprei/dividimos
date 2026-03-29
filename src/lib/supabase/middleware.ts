import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/demo", "/auth", "/auth/callback", "/api/dev/login", "/claim"];
const TWO_FA_EXEMPT_PATHS = ["/auth/verify-2fa", "/api/auth/2fa"];

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

  if (isPublicPath(pathname) && pathname !== "/auth") {
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/auth") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  const is2faExempt = TWO_FA_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (user && !is2faExempt) {
    const verified = request.cookies.get("2fa-verified");
    if (!verified) {
      const { data: userRow } = await supabase
        .from("users")
        .select("two_factor_enabled")
        .eq("id", user.id)
        .single();

      if (userRow?.two_factor_enabled) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/verify-2fa";
        return NextResponse.redirect(url);
      }
    }
  }

  supabaseResponse.headers.set("Cache-Control", "private, no-store");

  return supabaseResponse;
}
