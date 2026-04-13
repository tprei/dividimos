import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

    assert.match(cookie, /^base64-/);

    const session = decodeCookie(cookie);
    assert.equal(session.access_token, "access-token-abc");
    assert.equal(session.refresh_token, "refresh-token-xyz");
    assert.equal(session.token_type, "bearer");
    assert.equal(session.expires_in, 3600);
    assert.equal(typeof session.expires_at, "number");
    const user_obj = session.user as { id: string; email: string };
    assert.equal(user_obj.id, "user-123");
    assert.equal(user_obj.email, "test@example.com");
  });

  it("defaults refresh_token to 'noop' when refreshToken is empty string", () => {
    const user = makeUser({ refreshToken: "" });
    const session = decodeCookie(buildSessionCookie(user));
    assert.equal(session.refresh_token, "noop");
  });

  it("preserves 'noop' refresh token from JWT-minted users", () => {
    const user = makeUser({ refreshToken: "noop" });
    const session = decodeCookie(buildSessionCookie(user));
    assert.equal(session.refresh_token, "noop");
  });

  it("preserves a real refresh token when provided", () => {
    const user = makeUser({ refreshToken: "real-refresh-token" });
    const session = decodeCookie(buildSessionCookie(user));
    assert.equal(session.refresh_token, "real-refresh-token");
  });
});
