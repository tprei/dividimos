import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";
import { arrayOf, decodeUserProfile } from "@/lib/ledger/decode-expense";
import { advanceBlockListEpoch, catchUpBootstrap, currentBlockListEpoch } from "./bootstrap";
import { getAuthGeneration, rpc } from "./client";
import { loadConversation, readUserBlocks } from "./refresh";

async function publishBlocks(users: UserProfile[], readEpoch?: number): Promise<void> {
  if (!useAppStore.getState().hydrated) await useAppStore.persist.rehydrate();
  if (readEpoch !== undefined && currentBlockListEpoch() !== readEpoch) return;
  advanceBlockListEpoch();
  useAppStore.getState().applyUserBlocks(users);
}

function loadedConversationIds(): string[] {
  return Object.entries(useAppStore.getState().conversations)
    .filter(([, conversation]) => conversation.messages.length > 0)
    .map(([id]) => id);
}

function reloadClearedConversations(ids: string[], generation: number): void {
  if (getAuthGeneration() !== generation) return;
  const { conversations } = useAppStore.getState();
  for (const id of ids) {
    if (conversations[id]?.messages.length === 0) void loadConversation(id).catch(() => undefined);
  }
}

async function changeBlock(fn: "block_user" | "unblock_user", userId: string): Promise<void> {
  const generation = getAuthGeneration();
  const users = await rpc(fn, { p_user_id: userId }, (raw) => arrayOf(raw, [], decodeUserProfile));
  if (getAuthGeneration() !== generation) return;

  const loadedIds = loadedConversationIds();
  await publishBlocks(users);

  void catchUpBootstrap()
    .then(() => reloadClearedConversations(loadedIds, generation))
    .catch(() => undefined);
}

export function blockUser(userId: string): Promise<void> {
  return changeBlock("block_user", userId);
}

export function unblockUser(userId: string): Promise<void> {
  return changeBlock("unblock_user", userId);
}

export function handleBlocksChanged(): void {
  const generation = getAuthGeneration();
  const loadedIds = loadedConversationIds();
  advanceBlockListEpoch();
  void catchUpBootstrap()
    .then(() => reloadClearedConversations(loadedIds, generation))
    .catch(() => undefined);
}

export async function loadUserBlocks(): Promise<UserProfile[]> {
  const generation = getAuthGeneration();
  const epoch = currentBlockListEpoch();
  const users = await readUserBlocks();
  if (getAuthGeneration() === generation) await publishBlocks(users, epoch);
  return users;
}
