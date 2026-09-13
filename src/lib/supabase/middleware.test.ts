import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieToSet = {
  name: string;
  value: string;
  options: { path?: string; maxAge?: number; httpOnly?: boolean };
};
type CookieAdapter = {
  getAll: () => unknown;
  setAll: (cookies: CookieToSet[]) => void;
};

const getClaimsMock = vi.hoisted(() => vi.fn());
const createServerClientMock = vi.hoisted(() => vi.fn());
const gateMock = vi.hoisted(() => vi.fn(() => ({ compatible: true })));
let cookieAdapter: CookieAdapter | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("@/lib/financial-compatibility", () => ({
  evaluateServerFinancialGate: gateMock,
}));

import { updateSession } from "./middleware";

function makeRequest(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(`http://localhost${pathname}`);
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

beforeEach(() => {
  getClaimsMock.mockReset();
  createServerClientMock.mockReset();
  gateMock.mockReset();
  gateMock.mockReturnValue({ compatible: true });
  cookieAdapter = null;
  createServerClientMock.mockImplementation(
    (
      _url: unknown,
      _key: unknown,
      options: { cookies: CookieAdapter },
    ) => {
      cookieAdapter = options.cookies;
      return { auth: { getClaims: getClaimsMock } };
    },
  );
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://local.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("updateSession", () => {
  it.each(["/claim", "/join", "/u/example", "/auth/onboard", "/auth/continue"])(
    "verifies the session before returning %s",
    async (pathname) => {
      getClaimsMock.mockResolvedValue({
        data: null,
        error: { name: "AuthSessionMissingError", status: 401 },
      });

      const response = await updateSession(makeRequest(pathname));

      expect(response.status).toBe(200);
      expect(getClaimsMock).toHaveBeenCalledTimes(1);
    },
  );

  it("returns 503 for an auth outage with a configured session cookie", async () => {
    getClaimsMock.mockRejectedValue(new Error("auth unavailable"));

    const response = await updateSession(
      makeRequest("/claim", { "sb-local-auth-token.0": "session" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain("Tente novamente");
  });

  it("does not treat an unrelated cookie as a session on public routes", async () => {
    getClaimsMock.mockRejectedValue(new Error("auth unavailable"));

    const response = await updateSession(makeRequest("/claim", { theme: "dark" }));

    expect(response.status).toBe(200);
  });

  it("keeps an anonymous protected request as an auth redirect", async () => {
    getClaimsMock.mockResolvedValue({
      data: null,
      error: { name: "AuthSessionMissingError", status: 401 },
    });

    const response = await updateSession(makeRequest("/app"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth?next=%2Fapp");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("carries the destination's query string into the auth redirect", async () => {
    getClaimsMock.mockResolvedValue({
      data: null,
      error: { name: "AuthSessionMissingError", status: 401 },
    });

    const response = await updateSession(
      makeRequest("/app/bill/new?dm=bob&groupId=g1"),
    );

    const location = response.headers.get("location") ?? "";
    // /app/bill/new?dm=bob is a different screen from /app/bill/new.
    expect(location).toContain(
      `next=${encodeURIComponent("/app/bill/new?dm=bob&groupId=g1")}`,
    );
  });

  it("lands an authenticated visitor on the destination path and query", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    const response = await updateSession(
      makeRequest(
        `/auth?next=${encodeURIComponent("/app/bill/new?dm=bob&groupId=g1")}`,
      ),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/app/bill/new");
    expect(location.searchParams.get("dm")).toBe("bob");
    expect(location.searchParams.get("groupId")).toBe("g1");
  });

  it("still refuses an external destination", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    const response = await updateSession(
      makeRequest(`/auth?next=${encodeURIComponent("https://evil.example.com/x")}`),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.host).toBe("localhost");
    expect(location.pathname).toBe("/app");
  });

  it("preserves every rotated and deleted cookie on a public response", async () => {
    getClaimsMock.mockImplementation(async () => {
      cookieAdapter?.setAll([
        {
          name: "sb-local-auth-token.0",
          value: "first",
          options: { path: "/", httpOnly: true },
        },
        {
          name: "sb-local-auth-token.1",
          value: "second",
          options: { path: "/", httpOnly: true },
        },
      ]);
      cookieAdapter?.setAll([
        {
          name: "sb-local-auth-token.0",
          value: "",
          options: { path: "/", maxAge: 0, httpOnly: true },
        },
      ]);
      return {
        data: null,
        error: { name: "AuthSessionMissingError", status: 401 },
      };
    });

    const response = await updateSession(makeRequest("/claim"));
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("sb-local-auth-token.0=first");
    expect(setCookie).toContain("sb-local-auth-token.1=second");
    expect(setCookie).toContain("sb-local-auth-token.0=; Path=/; Max-Age=0; HttpOnly");
  });

  it("keeps API requests out of the anonymous redirect path", async () => {
    getClaimsMock.mockResolvedValue({
      data: null,
      error: { name: "AuthSessionMissingError", status: 401 },
    });

    const response = await updateSession(makeRequest("/api/private"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
