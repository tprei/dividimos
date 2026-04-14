import { describe, it, expect } from "vitest";

interface MinimalUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

function buildSessionCookie(user: MinimalUser): string {
  const session = {
    access_token: user.accessToken,
    refresh_token: user.refreshToken || "noop",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user.id, email: user.email },
  };
  const json = JSON.stringify(session);
  return "base64-" + Buffer.from(json).toString("base64url");
}

function decodeCookie(cookie: string): Record<string, unknown> {
  const base64 = cookie.replace("base64-", "");
  return JSON.parse(Buffer.from(base64, "base64url").toString());
}

function makeUser(overrides: Partial<MinimalUser> = {}): MinimalUser {
  return {
    id: "user-123",
    email: "test@example.com",
    accessToken: "access-token-abc",
    refreshToken: "refresh-token-xyz",
    ...overrides,
  };
}

describe("buildSessionCookie", () => {
  it("encodes a base64url session cookie with correct structure", () => {
    const user = makeUser();
    const cookie = buildSessionCookie(user);

    expect(cookie).toMatch(/^base64-/);

    const session = decodeCookie(cookie);
    expect(session.access_token).toBe("access-token-abc");
    expect(session.refresh_token).toBe("refresh-token-xyz");
    expect(session.token_type).toBe("bearer");
    expect(session.expires_in).toBe(3600);
    expect(typeof session.expires_at).toBe("number");
    const user_obj = session.user as { id: string; email: string };
    expect(user_obj.id).toBe("user-123");
    expect(user_obj.email).toBe("test@example.com");
  });

  it("defaults refresh_token to 'noop' when refreshToken is empty string", () => {
    const user = makeUser({ refreshToken: "" });
    const session = decodeCookie(buildSessionCookie(user));
    expect(session.refresh_token).toBe("noop");
  });

  it("preserves 'noop' refresh token from JWT-minted users", () => {
    const user = makeUser({ refreshToken: "noop" });
    const session = decodeCookie(buildSessionCookie(user));
    expect(session.refresh_token).toBe("noop");
  });

  it("preserves a real refresh token when provided", () => {
    const user = makeUser({ refreshToken: "real-refresh-token" });
    const session = decodeCookie(buildSessionCookie(user));
    expect(session.refresh_token).toBe("real-refresh-token");
  });
});
