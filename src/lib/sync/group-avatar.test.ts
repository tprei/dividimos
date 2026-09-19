import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateGroupAvatar } from "./group-avatar";
import { refreshGroup } from "./refresh";

const state = vi.hoisted(() => ({ generation: 0 }));
const mocks = vi.hoisted(() => ({
  compressImage: vi.fn(),
  fetch: vi.fn(),
  refreshGroup: vi.fn(),
}));
const MockImagePolicyError = vi.hoisted(() => class extends Error {});

vi.mock("@/lib/image-utils", () => ({
  compressImage: mocks.compressImage,
  ImagePolicyError: MockImagePolicyError,
}));
vi.mock("./client", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("./refresh", () => ({ refreshGroup: mocks.refreshGroup }));

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

describe("updateGroupAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.generation = 0;
    mocks.compressImage.mockResolvedValue(new File(["jpeg"], "avatar.jpg", { type: "image/jpeg" }));
    mocks.fetch.mockResolvedValue(response(204));
    mocks.refreshGroup.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("sends the selected emoji and refreshes once after acknowledgement", async () => {
    await updateGroupAvatar("g1", { kind: "emoji", emoji: "🍕" });

    expect(mocks.fetch).toHaveBeenCalledWith("/api/groups/g1/avatar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "emoji", emoji: "🍕" }),
    });
    expect(refreshGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroup).toHaveBeenCalledWith("g1");
  });

  it.each([
    [401, "unauthenticated", "unauthenticated"],
    [403, "not_a_member", "not_a_member"],
    [400, "invalid_operation", "invalid_argument"],
    [413, "image_too_large", "invalid_argument"],
    [415, "invalid_image", "invalid_argument"],
    [500, "backend_down", "network"],
  ] as const)("maps %s/%s without refreshing", async (status, code, expected) => {
    mocks.fetch.mockResolvedValue(response(status, { error: code }));

    await expect(updateGroupAvatar("g1", { kind: "initials" })).rejects.toMatchObject({
      code: expected,
    });
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("reconciles an unknown setter outcome before reporting a network error", async () => {
    mocks.fetch.mockResolvedValue(response(503, { error: "avatar_update_unknown" }));

    await expect(updateGroupAvatar("g1", { kind: "initials" })).rejects.toMatchObject({
      code: "network",
      message: "Não foi possível confirmar a alteração. Atualize o grupo antes de tentar de novo.",
    });
    expect(refreshGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroup).toHaveBeenCalledWith("g1");
  });

  it("does not publish a response after the auth generation changes", async () => {
    const pending = Promise.withResolvers<Response>();
    mocks.fetch.mockReturnValue(pending.promise);
    const update = updateGroupAvatar("g1", { kind: "initials" });
    state.generation = 1;
    pending.resolve(response(204));

    await expect(update).rejects.toMatchObject({ code: "unauthenticated" });
    expect(refreshGroup).not.toHaveBeenCalled();
  });
});
