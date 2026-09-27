import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";
import { arrayOf, decodeUserProfile } from "@/lib/ledger/decode-expense";
import { advanceBlockListEpoch, readUserBlocks, runBootstrap } from "./bootstrap";
import { getAuthGeneration, rpc } from "./client";
import { loadConversation } from "./refresh";

async function publishBlocks(users: UserProfile[]): Promise<void> {
  if (!useAppStore.getState().hydrated) await useAppStore.persist.rehydrate();
  advanceBlockListEpoch();
  useAppStore.getState().applyUserBlocks(users);
}

async function changeBlock(fn: "block_user" | "unblock_user", userId: string): Promise<void> {
  const generation = getAuthGeneration();
  const users = await rpc(fn, { p_user_id: userId }, (raw) => arrayOf(raw, [], decodeUserProfile));
  if (getAuthGeneration() !== generation) return;

  const reloadIds =
    fn === "unblock_user"
      ? Object.entries(useAppStore.getState().conversations)
          .filter(([, conversation]) => conversation.messages.length > 0)
          .map(([id]) => id)
      : [];
  await publishBlocks(users);

  void runBootstrap()
    .then(() => {
      if (getAuthGeneration() !== generation) return;
      for (const id of reloadIds) void loadConversation(id).catch(() => undefined);
    })
    .catch(() => undefined);
}

export function blockUser(userId: string): Promise<void> {
  return changeBlock("block_user", userId);
}

export function unblockUser(userId: string): Promise<void> {
  return changeBlock("unblock_user", userId);
}

export async function loadUserBlocks(): Promise<UserProfile[]> {
  const generation = getAuthGeneration();
  const users = await readUserBlocks();
  if (getAuthGeneration() === generation) await publishBlocks(users);
  return users;
}
