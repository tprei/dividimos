import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { GET, PATCH, PUT } from "./route";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";

vi.mock("server-only", () => ({}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {},
  }),
}));

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname.split(".")[0]}-auth-token`;

function accessTokenExpiry(accessToken: string): number {
  const raw: unknown = JSON.parse(
    Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8"),
  );
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("exp" in raw) ||
    typeof raw.exp !== "number"
  ) {
    throw new Error("test token has no expiry");
  }
  return raw.exp;
}

function photoIdFrom(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "photoId" in raw &&
    typeof raw.photoId === "string"
  ) {
    return raw.photoId;
  }
  throw new Error("fixture did not create a photo");
}

function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) throw new Error("test user has no session");
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(
      JSON.stringify({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
        token_type: "bearer",
        expires_at: accessTokenExpiry(user.accessToken),
      }),
    ).toString("base64url")}`,
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ groupId: id }) };
}

function imageRequest(method: "PUT" | "GET", id: string, body?: Uint8Array): NextRequest {
  return new NextRequest(`http://localhost/api/groups/${id}/avatar`, {
    method,
    body,
    headers: body ? { "content-type": "image/jpeg" } : undefined,
  });
}

describe.skipIf(!isIntegrationTestReady)("group avatar route persistence", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let testGroupId: string;

  beforeAll(async () => {
    [owner, member, outsider] = await createTestUsers(3);
    testGroupId = await createGroupWithMembers(owner, [member], "Avatar route");
  });

  it("updates metadata, stores a private JPEG, and serves only the current opaque id", async () => {
    actAs(owner);
    const emojiResponse = await PATCH(
      new NextRequest(`http://localhost/api/groups/${testGroupId}/avatar`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "emoji", emoji: "🏠" }),
      }),
      routeParams(testGroupId),
    );
    expect(emojiResponse.status).toBe(200);

    const input = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 25, g: 60, b: 120 } },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const uploadResponse = await PUT(
      imageRequest("PUT", testGroupId, input),
      routeParams(testGroupId),
    );
    expect(uploadResponse.status).toBe(200);

    const current = await authenticateAs(owner).rpc("get_group_avatar" as never, {
      p_group_id: testGroupId,
    } as never);
    expect(current.error).toBeNull();
    const photoId = photoIdFrom(current.data);
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);

    const served = await GET(
      new NextRequest(`http://localhost/api/groups/${testGroupId}/avatar?photoId=${photoId}`),
      routeParams(testGroupId),
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const stale = await GET(
      new NextRequest(`http://localhost/api/groups/${testGroupId}/avatar?photoId=${crypto.randomUUID()}`),
      routeParams(testGroupId),
    );
    expect(stale.status).toBe(404);

    const publicObject = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/group-avatars/${testGroupId}/${photoId}.jpg`,
    );
    expect(publicObject.ok).toBe(false);
  });

  it("does not disclose a photo to an outsider", async () => {
    actAs(owner);
    const current = await authenticateAs(owner).rpc("get_group_avatar" as never, {
      p_group_id: testGroupId,
    } as never);
    const photoId = photoIdFrom(current.data);

    actAs(outsider);
    const response = await GET(
      new NextRequest(`http://localhost/api/groups/${testGroupId}/avatar?photoId=${photoId}`),
      routeParams(testGroupId),
    );
    expect(response.status).toBe(404);
  });
});
