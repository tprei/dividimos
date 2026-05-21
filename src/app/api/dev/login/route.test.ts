import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

const TEST_SECRET = "test-secret-value";

const mockCookieSet = vi.fn();
const mockCookieGetAll = vi.fn(() => []);

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => mockCookieGetAll(),
    set: (...args: unknown[]) => mockCookieSet(...args),
  }),
}));

const mockVerifyOtp = vi.fn();
const mockSsrClient = {
  auth: {
    verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
  },
  from: (table: string) => ssrMock.client.from(table),
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => mockSsrClient),
}));

const adminMock = createMockSupabase();
const adminAuthMethods = {
  createUser: vi.fn(),
  generateLink: vi.fn(),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    ...adminMock.client,
    auth: {
      admin: adminAuthMethods,
    },
  })),
}));

let ssrMock: MockSupabase;

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/dev/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeAuthedRequest(body: Record<string, unknown>) {
  return makeRequest(body, { "x-dev-login-secret": TEST_SECRET });
}

beforeEach(() => {
  process.env.DEV_LOGIN_SECRET = TEST_SECRET;
  ssrMock = createMockSupabase();
  mockSsrClient.from = (table: string) => ssrMock.client.from(table);
  adminMock.reset();
  ssrMock.reset();
  mockCookieSet.mockClear();
  mockCookieGetAll.mockClear();
  mockVerifyOtp.mockClear();
  mockVerifyOtp.mockResolvedValue({ error: null });
  adminAuthMethods.createUser.mockClear();
  adminAuthMethods.generateLink.mockClear();
  adminAuthMethods.createUser.mockResolvedValue({
    data: { user: { id: "new-user-id" } },
    error: null,
  });
  adminAuthMethods.generateLink.mockResolvedValue({
    data: { properties: { action_link: "http://localhost?token_hash=abc123" } },
    error: null,
  });
});

afterEach(() => {
  delete process.env.DEV_LOGIN_SECRET;
  vi.unstubAllEnvs();
});

describe("POST /api/dev/login", () => {
  it("returns 404 in production regardless of secret", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("not_available");
  });

  it("returns 404 when DEV_LOGIN_SECRET env var is not set", async () => {
    delete process.env.DEV_LOGIN_SECRET;

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("not_available");
  });

  it("returns 401 when x-dev-login-secret header is missing", async () => {
    const response = await POST(makeRequest({ email: "alice@test.dividimos.local" }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when x-dev-login-secret header is wrong", async () => {
    const response = await POST(
      makeRequest({ email: "alice@test.dividimos.local" }, { "x-dev-login-secret": "wrong-secret" }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when email is not provided", async () => {
    const response = await POST(makeAuthedRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Provide 'email'");
  });

  it("returns 400 for non-@test.dividimos.local email", async () => {
    const response = await POST(makeAuthedRequest({ email: "attacker@evil.com" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Only @test.dividimos.local emails are allowed");
  });

  it("rejects email that merely contains but does not end with the allowed domain", async () => {
    const response = await POST(makeAuthedRequest({ email: "attacker@evil.com@test.dividimos.local.evil.org" }));

    expect(response.status).toBe(400);
  });

  it("normalizes email to lowercase before lookup and allowlist check", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const response = await POST(makeAuthedRequest({ email: "Alice@Test.Dividimos.LOCAL" }));

    expect(response.status).toBe(200);
    expect(adminAuthMethods.createUser).not.toHaveBeenCalled();
  });

  it("auto-creates user when email is not found in public.users", async () => {
    adminMock.onTable("users", { data: null });
    ssrMock.onTable("users", { data: { onboarded: false } });

    const response = await POST(makeAuthedRequest({ email: "new@test.dividimos.local" }));

    expect(response.status).toBe(200);
    expect(adminAuthMethods.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@test.dividimos.local",
        email_confirm: true,
      }),
    );
    const body = await response.json();
    expect(body.userId).toBe("new-user-id");
    expect(body.redirect).toBe("/auth/onboard");
  });

  it("returns success with userId when user row is found in public.users", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.userId).toBe("user-alice");
    expect(adminAuthMethods.createUser).not.toHaveBeenCalled();
  });

  it("returns 500 when generateLink fails", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    adminAuthMethods.generateLink.mockResolvedValue({
      data: null,
      error: { message: "link generation failed" },
    });

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to generate session");
    expect(body.error).not.toContain("link generation failed");
  });

  it("returns redirect /app for onboarded user and /auth/onboard for new user", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const onboardedResponse = await POST(
      makeAuthedRequest({ email: "alice@test.dividimos.local" }),
    );
    expect(onboardedResponse.status).toBe(200);
    const onboardedBody = await onboardedResponse.json();
    expect(onboardedBody.redirect).toBe("/app");

    adminMock.reset();
    ssrMock.reset();
    adminMock.onTable("users", { data: { id: "user-new", onboarded: false } });
    ssrMock.onTable("users", { data: { onboarded: false } });

    const newUserResponse = await POST(
      makeAuthedRequest({ email: "new@test.dividimos.local" }),
    );
    expect(newUserResponse.status).toBe(200);
    const newUserBody = await newUserResponse.json();
    expect(newUserBody.redirect).toBe("/auth/onboard");
  });

  it("response body does not contain a cookies field", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));
    const body = await response.json();

    expect(body).not.toHaveProperty("cookies");
  });

  it("500 response body does not leak raw error messages", async () => {
    adminMock.onTable("users", { data: { id: "user-alice", onboarded: true } });
    adminAuthMethods.generateLink.mockResolvedValue({
      data: null,
      error: { message: "internal supabase admin secret details" },
    });

    const response = await POST(makeAuthedRequest({ email: "alice@test.dividimos.local" }));
    const body = await response.json();

    expect(body.error).not.toContain("internal supabase admin secret details");
  });
});
