/**
 * Real-boundary coverage for GET /api/users/lookup.
 *
 * The route runs against the real database, the real rate limiter and the
 * real Supabase session reader. The only stub is the next/headers cookie
 * transport (the jar holds the actor's real sign-in tokens, encoded exactly
 * the way @supabase/ssr writes them), mirroring the pix persistence
 * integration test.
 *
 * Documented seam: for the limiter-unavailable case ONLY, enforceRateLimit
 * is replaced by a rejecting stub. A genuine limiter outage cannot be
 * produced without breaking the limiter's own infrastructure, so the 503
 * contract is proven by intercepting exactly that one seam; every other
 * case in this file runs the real limiter.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { createTestUsers, type TestUser } from "@/test/integration-helpers";

vi.mock("server-only", () => ({}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {
      // Writes back into a request-scoped cookie store carry no session
      // change these assertions depend on.
    },
  }),
}));

const rateLimitOverride = vi.hoisted(() => ({
  impl: null as null | ((bucket: unknown, subject: string) => Promise<void>),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<{
    enforceRateLimit: (bucket: never, subject: string) => Promise<void>;
  }>();
  return {
    enforceRateLimit: (bucket: never, subject: string) =>
      rateLimitOverride.impl
        ? rateLimitOverride.impl(bucket, subject)
        : actual.enforceRateLimit(bucket, subject),
  };
});

// Imported after the vi.mock factories and the cookieJar declaration: the
// factories close over module state, so the route module must only evaluate
// once that state exists (a static import would resolve them against
// uninitialized bindings).
const { GET } = await import("@/app/api/users/lookup/route");

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

/** exp claim of the real access token — the session's true expiry second. */
function accessTokenExpiry(accessToken: string): number {
  const payloadSegment = accessToken.split(".")[1];
  const payload = JSON.parse(
    Buffer.from(payloadSegment, "base64url").toString("utf8"),
  ) as { exp?: unknown };
  if (typeof payload.exp !== "number") {
    throw new Error("access token carries no exp claim");
  }
  return payload.exp;
}

function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) {
    throw new Error(`user ${user.handle} has no sign-in tokens`);
  }
  const session = {
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    token_type: "bearer",
    expires_at: accessTokenExpiry(user.accessToken),
  };
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  });
}

function clearSession(): void {
  cookieJar.splice(0, cookieJar.length);
}

function lookupRequest(handle: string | null): Request {
  const query = handle === null ? "" : `?handle=${encodeURIComponent(handle)}`;
  return new Request(`http://localhost/api/users/lookup${query}`);
}

function restRpcHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function directRestRpc(accessToken?: string): Promise<Response> {
  return fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/rpc/lookup_user_by_handle`, {
    method: "POST",
    headers: restRpcHeaders(accessToken),
    body: JSON.stringify({ p_handle: "whatever" }),
  });
}

async function graphql(query: string, accessToken?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!}/graphql/v1`, {
    method: "POST",
    headers: restRpcHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe.skipIf(!isIntegrationTestReady)("users lookup route boundary", () => {
  beforeAll(() => {
    if (process.env.RATE_LIMIT_DISABLED === "1") {
      throw new Error("the real boundary tests require the limiter to be on");
    }
  });

  it("serves the exact profile shape for an authenticated caller", async () => {
    const [requester, target] = await createTestUsers(2);
    actAs(requester);

    const response = await GET(lookupRequest(target.handle));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { profile: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["profile"]);
    expect(Object.keys(body.profile)).toEqual(["id", "handle", "name", "avatarUrl", "isBot"]);
    expect(body.profile).toEqual({
      id: target.id,
      handle: target.handle,
      name: target.name,
      avatarUrl: null,
      isBot: false,
    });
  });

  it("answers 404 for a handle nobody owns", async () => {
    const [requester] = await createTestUsers(1);
    actAs(requester);

    const response = await GET(lookupRequest("nao_existe_ninguem"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Usuário não encontrado" });
  });

  it("keeps pre-onboarding names private behind a 404", async () => {
    const [requester] = await createTestUsers(1);
    const [pending] = await createTestUsers(1, { onboarded: false });
    actAs(requester);

    // The handle is guessable from the signup email, so the OAuth name and
    // avatar must stay private until public profile setup finishes.
    const response = await GET(lookupRequest(pending.handle));

    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    clearSession();

    const response = await GET(lookupRequest("whatever"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });

  it("answers 400 for a handle that is empty after normalization", async () => {
    const [requester] = await createTestUsers(1);
    actAs(requester);

    const response = await GET(lookupRequest(null));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Handle obrigatorio" });
  });

  it("serves exactly 30 lookups per caller per window and then 429", async () => {
    const [requester, target] = await createTestUsers(2);
    actAs(requester);

    for (let spent = 1; spent <= 30; spent += 1) {
      const response = await GET(lookupRequest(target.handle));
      if (response.status !== 200) {
        throw new Error(`lookup ${spent}/30 already failed: ${response.status}`);
      }
    }

    const exhausted = await GET(lookupRequest(target.handle));
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });

    // The limit is per caller: another account still gets through.
    const [otherCaller] = await createTestUsers(1);
    actAs(otherCaller);
    await expect(GET(lookupRequest(target.handle))).resolves.toMatchObject({ status: 200 });
  });

  it("fails closed with 503 when the limiter is unavailable and skips the backing RPC", async () => {
    const [requester, target] = await createTestUsers(2);
    actAs(requester);

    // Documented seam (see file header): only enforceRateLimit is replaced,
    // for this one case, to model a limiter outage at the real boundary.
    rateLimitOverride.impl = () =>
      Promise.reject(new AppError("RATE_LIMIT_UNAVAILABLE", "limiter down"));
    try {
      const unavailable = await GET(lookupRequest(target.handle));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "Serviço temporariamente indisponível" });
    } finally {
      rateLimitOverride.impl = null;
    }

    // The infrastructure was never the problem: the next call goes through.
    await expect(GET(lookupRequest(target.handle))).resolves.toMatchObject({ status: 200 });
  });

  it("denies direct REST lookups for anonymous and authenticated browser roles", async () => {
    const [someone] = await createTestUsers(1);

    const anon = await directRestRpc();
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { message?: string }).message).toMatch(/permission denied/i);

    const authenticated = await directRestRpc(someone.accessToken);
    expect(authenticated.status).toBe(403);
    expect(((await authenticated.json()) as { message?: string }).message).toMatch(
      /permission denied/i,
    );
  });

  it("exposes no lookup data through GraphQL, even for aliased documents", async () => {
    const [target] = await createTestUsers(1);

    const { status, body } = await graphql(
      `{ a: lookup_user_by_handle(p_handle: "${target.handle}") ` +
        `b: lookup_user_by_handle(p_handle: "${target.handle}") ` +
        `c: lookup_user_by_handle(p_handle: "${target.handle}") }`,
    );

    // pg_graphql answers schema violations with HTTP 200 — inspect the body.
    expect(status).toBe(200);
    const data = body.data as Record<string, unknown> | null | undefined;
    for (const alias of ["a", "b", "c"]) {
      expect(data?.[alias]).toBeUndefined();
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(target.name);
    expect(serialized).not.toContain(target.id);
  });

  it("still serves a permitted authenticated read through GraphQL", async () => {
    const [reader] = await createTestUsers(1);

    const { status, body } = await graphql(`{ get_my_profile }`, reader.accessToken);

    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();
    const data = body.data as { get_my_profile?: string };
    expect(typeof data.get_my_profile).toBe("string");
    expect(data.get_my_profile).toContain(reader.id);
  });

  it("denies an unauthorized object read through GraphQL", async () => {
    const { status, body } = await graphql(`{ usersCollection { edges { node { id } } } }`);

    // pg_graphql answers schema violations with HTTP 200 — inspect the body.
    expect(status).toBe(200);
    expect(Array.isArray(body.errors)).toBe(true);
    expect((body.data as Record<string, unknown> | null)?.usersCollection).toBeUndefined();
  });
});
