import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app-store";
import type { ChatMessage, UserProfile } from "@/types/ledger";
import { blockUser, loadUserBlocks, unblockUser } from "./user-blocks";

const rpcMock = vi.hoisted(() => vi.fn());
const authGeneration = vi.hoisted(() => ({ value: 0 }));
const runBootstrapMock = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
const advanceEpochMock = vi.hoisted(() => vi.fn());
const readUserBlocksMock = vi.hoisted(() => vi.fn<() => Promise<UserProfile[]>>());
const loadConversationMock = vi.hoisted(() => vi.fn<(groupId: string) => Promise<null>>(async () => null));

vi.mock("./client", () => ({
  rpc: (...args: unknown[]) => rpcMock(...args),
  getAuthGeneration: () => authGeneration.value,
}));
vi.mock("./bootstrap", () => ({
  runBootstrap: () => runBootstrapMock(),
  advanceBlockListEpoch: () => advanceEpochMock(),
  readUserBlocks: () => readUserBlocksMock(),
}));
vi.mock("./refresh", () => ({
  loadConversation: (groupId: string) => loadConversationMock(groupId),
}));

const other: UserProfile = { id: "u-other", handle: "other", name: "Other", avatarUrl: null, isBot: false };
const friend: UserProfile = { id: "u-friend", handle: "friend", name: "Friend", avatarUrl: null, isBot: false };

function messageFrom(sender: UserProfile, id: string): ChatMessage {
  return {
    id,
    clientId: id,
    groupId: "g1",
    senderId: sender.id,
    content: `msg ${id}`,
    erased: false,
    createdAt: "2026-09-27T10:00:00Z",
    sender,
  };
}

function seedConversation(messages: ChatMessage[]): void {
  useAppStore.getState().applyConversation("g1", { kind: "broadcast", messages, events: [] });
}

beforeEach(() => {
  useAppStore.getState().reset();
  rpcMock.mockReset();
  runBootstrapMock.mockReset().mockResolvedValue(undefined);
  advanceEpochMock.mockClear();
  readUserBlocksMock.mockReset();
  loadConversationMock.mockReset().mockResolvedValue(null);
  authGeneration.value = 0;
});

describe("user block mutations", () => {
  it("publishes the acknowledged list and hides cached messages without refetching conversations", async () => {
    seedConversation([messageFrom(friend, "m1"), messageFrom(other, "m2")]);
    rpcMock.mockResolvedValueOnce([other]);

    await blockUser(other.id);

    expect(rpcMock).toHaveBeenCalledWith("block_user", { p_user_id: other.id }, expect.any(Function));
    expect(advanceEpochMock).toHaveBeenCalledOnce();
    expect(useAppStore.getState().blockedUsers).toEqual([other]);
    expect(useAppStore.getState().conversations.g1?.messages.map((m) => m.id)).toEqual(["m1"]);
    await vi.waitFor(() => expect(runBootstrapMock).toHaveBeenCalledOnce());
    expect(loadConversationMock).not.toHaveBeenCalled();
  });

  it("resolves once the server acknowledges, even when the follow-up refresh fails", async () => {
    seedConversation([messageFrom(friend, "m1")]);
    rpcMock.mockResolvedValueOnce([other]);
    runBootstrapMock.mockRejectedValueOnce(new Error("offline"));

    await expect(blockUser(other.id)).resolves.toBeUndefined();

    expect(useAppStore.getState().blockedUsers).toEqual([other]);
  });

  it("drops the acknowledgment when the account changed while the request was in flight", async () => {
    const pending = Promise.withResolvers<UserProfile[]>();
    rpcMock.mockReturnValueOnce(pending.promise);

    const result = blockUser(other.id);
    authGeneration.value = 1;
    pending.resolve([other]);
    await result;

    expect(useAppStore.getState().blockedUsers).toEqual([]);
    expect(runBootstrapMock).not.toHaveBeenCalled();
  });

  it("resets loaded windows on unblock so the hidden history pages back in", async () => {
    useAppStore.getState().applyUserBlocks([other]);
    seedConversation([messageFrom(friend, "m1")]);
    rpcMock.mockResolvedValueOnce([]);

    await unblockUser(other.id);

    const conversation = useAppStore.getState().conversations.g1;
    expect(useAppStore.getState().blockedUsers).toEqual([]);
    expect(conversation?.messages).toEqual([]);
    expect(conversation?.messagesComplete).toBe(false);
    await vi.waitFor(() => expect(loadConversationMock).toHaveBeenCalledWith("g1"));
  });

  it("surfaces a refused block without publishing anything", async () => {
    rpcMock.mockRejectedValueOnce(new Error("member_excluded"));

    await expect(blockUser(other.id)).rejects.toThrow();

    expect(useAppStore.getState().blockedUsers).toEqual([]);
    expect(runBootstrapMock).not.toHaveBeenCalled();
  });

  it("rehydrates the persisted store before publishing a list read outside the app shell", async () => {
    useAppStore.setState({ hydrated: false });
    const rehydrate = vi.spyOn(useAppStore.persist, "rehydrate").mockImplementation(async () => {
      useAppStore.setState({ hydrated: true });
    });
    readUserBlocksMock.mockResolvedValueOnce([other]);

    await loadUserBlocks();

    expect(rehydrate).toHaveBeenCalledOnce();
    expect(useAppStore.getState().blockedUsers).toEqual([other]);
    rehydrate.mockRestore();
  });
});
