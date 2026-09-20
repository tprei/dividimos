import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { GET, PATCH, PUT } from "./route";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
vi.mock("server-only", () => ({}));


const cookieJar: Array<{ name: string; value: string }> = [];
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [...cookieJar], set: () => {} }) }));
const authCookie = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname.split(".")[0]}-auth-token`;

function accessTokenExpiry(token: string): number {
  const raw: unknown = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  if (typeof raw === "object" && raw !== null && "exp" in raw && typeof raw.exp === "number") return raw.exp;
  throw new Error("test token has no expiry");
}
function photoIdFrom(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "photoId" in raw && typeof raw.photoId === "string") return raw.photoId;
  throw new Error("fixture did not create a photo");
}
function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) throw new Error("test user has no session");
  cookieJar.splice(0, cookieJar.length, { name: authCookie, value: `base64-${Buffer.from(JSON.stringify({ access_token: user.accessToken, refresh_token: user.refreshToken, token_type: "bearer", expires_at: accessTokenExpiry(user.accessToken) })).toString("base64url")}` });
}
function routeParams(id: string) { return { params: Promise.resolve({ groupId: id }) }; }
function imageRequest(id: string, body: Uint8Array): NextRequest {
  return new NextRequest(`http://localhost/api/groups/${id}/avatar`, { method: "PUT", body: Buffer.from(body), headers: { "content-type": "image/jpeg" } });
}

describe.skipIf(!isIntegrationTestReady)("group avatar route persistence", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [owner, member, outsider] = await createTestUsers(3);
    groupId = await createGroupWithMembers(owner, [member], "Avatar route");
  });

  it("updates metadata, stores a private JPEG, serves the current id, and hides it from outsiders", async () => {
    actAs(owner);
    const emoji = await PATCH(new NextRequest(`http://localhost/api/groups/${groupId}/avatar`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "emoji", emoji: "🏠" }) }), routeParams(groupId));
    expect(emoji.status).toBe(200);
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 25, g: 60, b: 120 } } }).jpeg().withMetadata().toBuffer();
    expect((await PUT(imageRequest(groupId, input), routeParams(groupId))).status).toBe(200);
    const current = await authenticateAs(owner).rpc("get_group_avatar" as never, { p_group_id: groupId } as never);
    expect(current.error).toBeNull();
    const photoId = photoIdFrom(current.data);
    const served = await GET(new NextRequest(`http://localhost/api/groups/${groupId}/avatar?photoId=${photoId}`), routeParams(groupId));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await GET(new NextRequest(`http://localhost/api/groups/${groupId}/avatar?photoId=${crypto.randomUUID()}`), routeParams(groupId))).status).toBe(404);
    const publicObject = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/group-avatars/${groupId}/${photoId}.jpg`);
    expect(publicObject.ok).toBe(false);
    actAs(outsider);
    expect((await GET(new NextRequest(`http://localhost/api/groups/${groupId}/avatar?photoId=${photoId}`), routeParams(groupId))).status).toBe(404);
  });
});
