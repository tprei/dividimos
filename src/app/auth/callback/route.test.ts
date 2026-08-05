import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { GET } from "./route";

type ProfileOutcome = { data: { onboarded: boolean } | null; error: unknown };

function makeClient(opts: {
  user: { id: string } | null;
  exchangeError: unknown;
  profile: ProfileOutcome;
}) {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: opts.user }, error: null });
  const exchangeCodeForSession = vi
    .fn()
    .mockResolvedValue({ error: opts.exchangeError });
  const single = vi.fn().mockResolvedValue(opts.profile);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    auth: { getUser, exchangeCodeForSession },
    from,
  } as unknown as SupabaseClient<Database>;
}

function makeRequest(search: Record<string, string | undefined>) {
  const url = new URL("http://localhost/auth/callback");
  for (const [k, v] of Object.entries(search)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return new Request(url);
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("GET /auth/callback", () => {
  it("routes a verified, non-onboarded user to onboarding with the sanitized next", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: { id: "user-a" },
        exchangeError: null,
        profile: { data: { onboarded: false }, error: null },
      }),
    );

    const res = await GET(makeRequest({ code: "abc", next: "/dashboard" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/auth/onboard?next=%2Fdashboard",
    );
  });

  it("routes a verified, onboarded user to the sanitized next", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: { id: "user-a" },
        exchangeError: null,
        profile: { data: { onboarded: true }, error: null },
      }),
    );

    const res = await GET(makeRequest({ code: "abc", next: "//evil.com" }));

    expect(res.status).toBe(307);
    // Unsafe next collapses to /app.
    expect(res.headers.get("location")).toBe("http://localhost/app");
  });

  it("returns callback_failed and never honors next when the exchange errors", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: { id: "user-a" },
        exchangeError: { message: "bad code" },
        profile: { data: { onboarded: true }, error: null },
      }),
    );

    const res = await GET(makeRequest({ code: "abc", next: "/dashboard" }));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/auth?error=callback_failed");
    expect(location).not.toContain("dashboard");
  });

  it("returns callback_failed and never honors next when the exchange succeeds but there is no verified user", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: null,
        exchangeError: null,
        profile: { data: { onboarded: true }, error: null },
      }),
    );

    const res = await GET(makeRequest({ code: "abc", next: "/dashboard" }));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/auth?error=callback_failed");
    expect(location).not.toContain("dashboard");
  });

  it("routes to onboarding when the profile row is missing or unreadable", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: { id: "user-a" },
        exchangeError: null,
        profile: { data: null, error: null },
      }),
    );

    const res = await GET(makeRequest({ code: "abc", next: "/app" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/onboard");
  });

  it("returns callback_failed when there is no code", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        user: { id: "user-a" },
        exchangeError: null,
        profile: { data: { onboarded: true }, error: null },
      }),
    );

    const res = await GET(makeRequest({ next: "/dashboard" }));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/auth?error=callback_failed");
  });
});
