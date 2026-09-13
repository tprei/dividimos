import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirect } from "@/lib/safe-redirect";
import { evaluateServerFinancialGate } from "@/lib/financial-compatibility";

const PUBLIC_PATHS = [
  "/",
  "/demo",
  "/auth",
  "/auth/callback",
  "/api/dev/login",
  "/claim",
  "/join",
  "/.well-known",
  "/u",
  "/manutencao",
  "/terms",
  "/privacy",
];

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")),
  );
}

function hasSupabaseSessionCookie(request: NextRequest, supabaseUrl: string): boolean {
  let projectRef: string;
  try {
    projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return false;
  }
  if (!projectRef) return false;
  const prefix = `sb-${projectRef}-auth-token`;
  return request.cookies.getAll().some(
    ({ name }) => name === prefix || name.startsWith(`${prefix}.`),
  );
}

function isExplicitNoSession(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; status?: unknown };
  return (
    candidate.name === "AuthSessionMissingError" ||
    candidate.status === 401
  );
}
function applyPendingCookies(
  response: NextResponse,
  cookies: readonly PendingCookie[],
): NextResponse {
  for (const cookie of cookies) {
    const carrier = NextResponse.next();
    carrier.cookies.set(cookie.name, cookie.value, cookie.options);
    const serialized = carrier.headers.get("set-cookie");
    if (serialized) response.headers.append("Set-Cookie", serialized);
  }
  return response;
}

/**
 * Assigns a validated internal destination to `url` as separate components.
 *
 * `safeRedirect` returns a path that may include a query string; assigning
 * that whole string to `url.pathname` percent-encodes the `?` and turns
 * `/app/bill/new?dm=bob` into a single nonexistent path.
 */
function applyDestination(url: URL, destination: string): void {
  const separator = destination.indexOf("?");
  if (separator === -1) {
    url.pathname = destination;
    url.search = "";
    return;
  }
  url.pathname = destination.slice(0, separator);
  url.search = destination.slice(separator);
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function authUnavailableResponse(
  request: NextRequest,
  cookies: readonly PendingCookie[],
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return applyPendingCookies(
      NextResponse.json(
        { error: "Serviço de autenticação indisponível", retryable: true },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      ),
      cookies,
    );
  }

  return applyPendingCookies(
    new NextResponse(
      "Não foi possível verificar sua sessão. Tente novamente.",
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
    ),
    cookies,
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
    return noStore(NextResponse.redirect(url));
  }

  const pendingCookies: PendingCookie[] = [];
  let supabaseResponse = NextResponse.next({ request });
  let responseVersion = 0;
  let appliedVersion = 0;

  const finish = (response: NextResponse): NextResponse => {
    if (response === supabaseResponse && appliedVersion === responseVersion) {
      return response;
    }
    if (response === supabaseResponse) appliedVersion = responseVersion;
    return applyPendingCookies(response, pendingCookies);
  };

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
            pendingCookies.push(cookie);
          }
          responseVersion++;
          supabaseResponse = applyPendingCookies(
            NextResponse.next({ request }),
            pendingCookies,
          );
          appliedVersion = responseVersion;
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;
  let data: Awaited<ReturnType<typeof supabase.auth.getClaims>>["data"] = null;
  let error: unknown = null;
  let threw = false;
  try {
    ({ data, error } = await supabase.auth.getClaims());
  } catch (caught) {
    threw = true;
    error = caught;
  }

  const hasSessionCookie = hasSupabaseSessionCookie(request, supabaseUrl);
  const verificationUnavailable =
    threw || (Boolean(error) && !isExplicitNoSession(error));
  if (verificationUnavailable && hasSessionCookie) {
    return authUnavailableResponse(request, pendingCookies);
  }

  const user =
    !verificationUnavailable && data?.claims?.sub
      ? { id: data.claims.sub }
      : null;

  if (isPublicPath(pathname) && pathname !== "/auth" && pathname !== "/") {
    return finish(supabaseResponse);
  }

  if (!user && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    // The query string is part of the destination: /app/bill/new?dm=bob is a
    // different screen from /app/bill/new.
    const destination = `${pathname}${request.nextUrl.search}`;
    url.pathname = "/auth";
    url.search = `?next=${encodeURIComponent(destination)}`;
    return noStore(finish(NextResponse.redirect(url)));
  }

  if (user && !isPublicPath(pathname)) {
    const gate = evaluateServerFinancialGate();
    if (!gate.compatible) {
      const url = request.nextUrl.clone();
      url.pathname = "/manutencao";
      url.search = `?reason=${encodeURIComponent(gate.issue.code)}`;
      return noStore(finish(NextResponse.redirect(url)));
    }
  }

  if (user && (pathname === "/auth" || pathname === "/")) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    // safeRedirect returns a validated path that may carry a query string;
    // assigning it whole to `pathname` would percent-encode the `?`.
    applyDestination(url, safeRedirect(nextParam));
    return noStore(finish(NextResponse.redirect(url)));
  }

  if (!pathname.startsWith("/app")) {
    supabaseResponse.headers.set("Cache-Control", "private, no-store");
  }

  return finish(supabaseResponse);
}
