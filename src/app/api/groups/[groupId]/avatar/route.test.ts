import { NextRequest } from "next/server";
import { GET, PATCH, PUT } from "./route";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  callerRpc: vi.fn(),
  adminRpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  sharp: vi.fn(),
  metadata: vi.fn(),
  rotate: vi.fn(),
  resize: vi.fn(),
  jpeg: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.callerRpc,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mocks.adminRpc,
    storage: { from: vi.fn(() => ({
      upload: mocks.upload,
      remove: mocks.remove,
      download: mocks.download,
    })) },
  })),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => ({})),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("sharp", () => ({ default: mocks.sharp }));

const params = { params: Promise.resolve({ groupId: "11111111-1111-1111-1111-111111111111" }) };

function nextRequest(
  method: string,
  body?: BodyInit,
  url = "http://localhost/api/groups/group/avatar",
): NextRequest {
  return new NextRequest(url, {
    method,
    body,
    headers: body instanceof Uint8Array ? { "content-type": "image/jpeg" } : undefined,
  });
}

describe("group avatar route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } }, error: null });
    mocks.callerRpc.mockResolvedValue({ data: { kind: "initials" }, error: null });
    mocks.adminRpc.mockResolvedValue({
      data: {
        groupId: "11111111-1111-1111-1111-111111111111",
        ledgerVersion: 2,
        previousPhotoId: null,
      },
      error: null,
    });
    mocks.upload.mockResolvedValue({ data: { path: "group/photo.jpg" }, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: null });
    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      error: null,
    });
    mocks.metadata.mockResolvedValue({ format: "jpeg", pages: 1 });
    mocks.toBuffer.mockResolvedValue({ data: Buffer.from([1, 2, 3]) });
    mocks.jpeg.mockReturnValue({ toBuffer: mocks.toBuffer });
    mocks.resize.mockReturnValue({ jpeg: mocks.jpeg });
    mocks.rotate.mockReturnValue({ resize: mocks.resize });
    mocks.sharp.mockReturnValue({ metadata: mocks.metadata, rotate: mocks.rotate });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("no session") });

    const response = await PATCH(nextRequest("PATCH", JSON.stringify({ kind: "initials" })), params);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("rejects an emoji outside the fixed palette", async () => {
    const response = await PATCH(nextRequest("PATCH", JSON.stringify({ kind: "emoji", emoji: "😀" })), params);

    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("maps a definite membership rejection to 403", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "not_a_member" } });

    const response = await PATCH(nextRequest("PATCH", JSON.stringify({ kind: "emoji", emoji: "🏠" })), params);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_a_member" });
  });

  it("rejects an oversized streamed body before image decoding", async () => {
    const response = await PUT(nextRequest("PUT", new Uint8Array(1024 * 1024 + 1)), params);

    expect(response.status).toBe(413);
    expect(mocks.sharp).not.toHaveBeenCalled();
  });

  it("rejects bytes sharp cannot decode as a JPEG", async () => {
    mocks.sharp.mockImplementation(() => {
      throw new Error("not an image");
    });

    const response = await PUT(nextRequest("PUT", new Uint8Array([1, 2, 3])), params);

    expect(response.status).toBe(415);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("deletes a fresh object after a definite setter rejection", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "not_a_member" } });

    const response = await PUT(nextRequest("PUT", new Uint8Array([1, 2, 3])), params);

    expect(response.status).toBe(403);
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringMatching(/^11111111-1111-1111-1111-111111111111\/.+\.jpg$/)]);
  });

  it("keeps the fresh object after an ambiguous setter failure", async () => {
    mocks.adminRpc.mockRejectedValue(new Error("socket closed"));

    const response = await PUT(nextRequest("PUT", new Uint8Array([1, 2, 3])), params);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "avatar_update_unknown" });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns the mutation acknowledgement for a successful patch", async () => {
    const response = await PATCH(nextRequest("PATCH", JSON.stringify({ kind: "emoji", emoji: "🏠" })), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      groupId: "11111111-1111-1111-1111-111111111111",
      ledgerVersion: 2,
      eventId: null,
    });
  });

  it("serves the current photo only for its opaque id", async () => {
    mocks.callerRpc.mockResolvedValue({ data: { kind: "photo", photoId: "photo-id" }, error: null });

    const wrong = await GET(
      nextRequest("GET", undefined, "http://localhost/api/groups/group/avatar?photoId=other"),
      params,
    );
    expect(wrong.status).toBe(404);

    const current = await GET(
      nextRequest("GET", undefined, "http://localhost/api/groups/group/avatar?photoId=photo-id"),
      params,
    );
    expect(current.status).toBe(200);
    expect(current.headers.get("cache-control")).toBe("private, no-store");
    expect(current.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
