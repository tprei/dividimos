import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

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
  listUsers: vi.fn(),
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

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/dev/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED = "true";
  ssrMock = createMockSupabase();
  mockSsrClient.from = (table: string) => ssrMock.client.from(table);
  adminMock.reset();
  ssrMock.reset();
  mockCookieSet.mockClear();
  mockCookieGetAll.mockClear();
  mockVerifyOtp.mockClear();
  mockVerifyOtp.mockResolvedValue({ error: null });
  adminAuthMethods.listUsers.mockClear();
  adminAuthMethods.createUser.mockClear();
  adminAuthMethods.generateLink.mockClear();
  adminAuthMethods.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
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
  delete process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED;
});

describe("POST /api/dev/login", () => {
  it("returns 403 when dev login is not enabled", async () => {
    delete process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED;

    const response = await POST(makeRequest({ email: "alice@test.pagajaja.local" }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("NEXT_PUBLIC_DEV_LOGIN_ENABLED");
  });

  it("returns 400 when email is not provided", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Provide 'email'");
  });

  it("returns 404-equivalent: creates user when email not found", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [] },
      error: null,
    });
    ssrMock.onTable("users", { data: { onboarded: false } });

    const response = await POST(makeRequest({ email: "new@test.pagajaja.local" }));

    expect(response.status).toBe(200);
    expect(adminAuthMethods.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@test.pagajaja.local",
        email_confirm: true,
      }),
    );
    const body = await response.json();
    expect(body.userId).toBe("new-user-id");
  });

  it("returns success with userId when email user is found", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-alice", email: "alice@test.pagajaja.local" }] },
      error: null,
    });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const response = await POST(makeRequest({ email: "alice@test.pagajaja.local" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.userId).toBe("user-alice");
  });

  it("does not call createUser when email user already exists", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-alice", email: "alice@test.pagajaja.local" }] },
      error: null,
    });
    ssrMock.onTable("users", { data: { onboarded: true } });

    await POST(makeRequest({ email: "alice@test.pagajaja.local" }));

    expect(adminAuthMethods.createUser).not.toHaveBeenCalled();
  });

  it("returns 500 when generateLink fails", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-alice", email: "alice@test.pagajaja.local" }] },
      error: null,
    });
    adminAuthMethods.generateLink.mockResolvedValue({
      data: null,
      error: { message: "link generation failed" },
    });

    const response = await POST(makeRequest({ email: "alice@test.pagajaja.local" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("Failed to generate session");
  });

  it("returns redirect /app for onboarded user and /auth/onboard for new user", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-alice", email: "alice@test.pagajaja.local" }] },
      error: null,
    });
    ssrMock.onTable("users", { data: { onboarded: true } });

    const onboardedResponse = await POST(
      makeRequest({ email: "alice@test.pagajaja.local" }),
    );
    expect(onboardedResponse.status).toBe(200);
    const onboardedBody = await onboardedResponse.json();
    expect(onboardedBody.redirect).toBe("/app");

    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-new", email: "new@test.pagajaja.local" }] },
      error: null,
    });
    ssrMock.onTable("users", { data: { onboarded: false } });

    const newUserResponse = await POST(
      makeRequest({ email: "new@test.pagajaja.local" }),
    );
    expect(newUserResponse.status).toBe(200);
    const newUserBody = await newUserResponse.json();
    expect(newUserBody.redirect).toBe("/auth/onboard");
  });

  it("returns 500 when createUser fails", async () => {
    adminAuthMethods.listUsers.mockResolvedValue({
      data: { users: [] },
      error: null,
    });
    adminAuthMethods.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "creation failed" },
    });

    const response = await POST(makeRequest({ email: "fail@test.pagajaja.local" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("Failed to create user");
  });
});
