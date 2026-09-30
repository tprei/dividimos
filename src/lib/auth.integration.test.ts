import { beforeAll, describe, expect, it, vi } from "vitest";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { createTestUsers, withPg, type TestUser } from "@/test/integration-helpers";

vi.mock("server-only", () => ({}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {},
  }),
}));

const { resolveAuthProfile } = await import("@/lib/auth");

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

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
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
      token_type: "bearer",
      expires_at: accessTokenExpiry(user.accessToken),
    })).toString("base64url")}`,
  });
}

describe.skipIf(!isIntegrationTestReady)("resolveAuthProfile", () => {
  let user: TestUser;

  beforeAll(async () => {
    [user] = await createTestUsers(1);
  });

  it("resolves the signed-in profile", async () => {
    actAs(user);
    const result = await resolveAuthProfile();
    expect(result.kind).toBe("ok");
  });

  it("reports account_deleted once the tombstone is set", async () => {
    await withPg(async (pg) => {
      await pg.query("update users set deleted_at = now() where id = $1", [user.id]);
    });

    actAs(user);
    const result = await resolveAuthProfile();
    expect(result).toEqual({ kind: "account_deleted" });
  });
});
