import type { RealtimeChannel } from "@supabase/supabase-js";
import { decodeChatMessage } from "@/lib/ledger/decode";
import { useAppStore } from "@/stores/app-store";
import type { AppState } from "@/stores/app-store";
import { mergeConversation } from "@/stores/app-store-merge";
import {
  invalidateChatReconciliation,
  isMalformedHint,
  reconcileChat,
} from "./chat-reconcile";
import type { ChatMessage, GroupSnapshot } from "@/types/ledger";
import { runBootstrap } from "./bootstrap";
import { getSupabase } from "./client";
import { refreshGroup } from "./refresh";

interface LedgerBroadcastPayload {
  group_id: string;
  ledger_version: number;
  event_id: number;
}

function parseLedgerPayload(raw: unknown): LedgerBroadcastPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!("group_id" in raw && "ledger_version" in raw && "event_id" in raw)) {
    return null;
  }
  const { group_id, ledger_version, event_id } = raw;
  if (
    typeof group_id !== "string" ||
    typeof ledger_version !== "number" ||
    typeof event_id !== "number" ||
    !Number.isFinite(ledger_version) ||
    !Number.isFinite(event_id)
  ) {
    return null;
  }
  return { group_id, ledger_version, event_id };
}

interface MembershipBroadcastPayload {
  group_id: string;
}

export function parseMembershipPayload(
  raw: unknown,
): MembershipBroadcastPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!("group_id" in raw)) return null;
  const { group_id } = raw;
  if (typeof group_id !== "string") return null;
  return { group_id };
}

export function shouldRefreshGroup(
  snapshot: GroupSnapshot | undefined,
  payload: unknown,
): boolean {
  const parsed = parseLedgerPayload(payload);
  if (!parsed) return false;
  if (!snapshot) return true;
  return (
    parsed.ledger_version > snapshot.group.ledgerVersion ||
    parsed.event_id > snapshot.lastEventId
  );
}

export function mergeChatBroadcast(
  state: AppState,
  groupId: string,
  message: ChatMessage,
): Partial<AppState> {
  const existingConv = state.conversations[groupId];
  const isDuplicate =
    existingConv?.messages.some(
      (m) => m.id === message.id || m.clientId === message.clientId,
    ) ?? false;

  const patch: Partial<AppState> = {};

  if (!isDuplicate) {
    // The shared reducer owns identity and ordering; a live row never changes
    // either stream's cursor or completeness.
    patch.conversations = {
      ...state.conversations,
      [groupId]: mergeConversation(
        existingConv,
        { kind: "broadcast", messages: [message], events: [] },
        state.me?.id ?? null,
      ),
    };
  }

  const existingGroup = state.groups[groupId];
  if (existingGroup) {
    const updatedGroup: GroupSnapshot = {
      ...existingGroup,
      lastMessage: {
        content: message.content,
        senderId: message.senderId,
        createdAt: message.createdAt,
      },
      unreadCount:
        !isDuplicate && message.senderId !== state.me?.id
          ? existingGroup.unreadCount + 1
          : existingGroup.unreadCount,
    };

    patch.groups = {
      ...state.groups,
      [groupId]: updatedGroup,
    };
  }

  return patch;
}

function handleLedgerBroadcast(groupId: string, payload: unknown): void {
  const snapshot = useAppStore.getState().groups[groupId];
  if (shouldRefreshGroup(snapshot, payload)) {
    void refreshGroup(groupId).catch(() => {});
  }
}

function handleChatBroadcast(groupId: string, payload: unknown): void {
  const decoded = decodeChatMessage(payload);
  if (!decoded.ok) return;

  // A row older than everything we hold proves a gap the live stream cannot
  // fill, so schedule one coalesced reconciliation instead of a query burst.
  const gapped = isMalformedHint(groupId, decoded.value.createdAt);

  useAppStore
    .getState()
    .patch((state) => mergeChatBroadcast(state, groupId, decoded.value));

  if (gapped) reconcileChat(groupId);
}

let membershipInFlight: Promise<void> | null = null;
let membershipPending: Promise<void> | null = null;

function runMembershipRefresh(): Promise<void> {
  const task = runBootstrap().finally(() => {
    membershipInFlight = null;
    const followUp = membershipPending;
    if (followUp) {
      membershipPending = null;
      membershipInFlight = followUp;
    }
  });
  membershipInFlight = task;
  return task;
}

function refreshMemberships(): Promise<void> {
  const current = membershipInFlight;
  if (!current) return runMembershipRefresh();

  const scheduled = membershipPending;
  if (scheduled) return scheduled;

  const followUp = current
    .catch(() => undefined)
    .then(() => runMembershipRefresh());
  membershipPending = followUp;
  return followUp;
}

function handleMembershipBroadcast(payload: unknown): void {
  if (!parseMembershipPayload(payload)) return;
  void refreshMemberships().catch(() => {});
}

function onRecovery(onRecovered: () => void): (status: string) => void {
  let lost = false;
  return (status) => {
    if (status !== "SUBSCRIBED") {
      lost = true;
      return;
    }
    if (!lost) return;
    lost = false;
    onRecovered();
  };
}

export function startRealtime(): () => void {
  const channels = new Map<string, RealtimeChannel>();
  let userChannel: RealtimeChannel | null = null;
  let userChannelUserId: string | null = null;

  function syncChannels(): void {
    const desiredIds = new Set(useAppStore.getState().groupOrder);

    for (const [id, ch] of channels) {
      if (!desiredIds.has(id)) {
        void getSupabase().removeChannel(ch);
        channels.delete(id);
      }
    }

    for (const id of desiredIds) {
      if (!channels.has(id)) {
        const ch = getSupabase()
          .channel(`group:${id}`, { config: { private: true } })
          .on("broadcast", { event: "ledger" }, ({ payload }) => {
            handleLedgerBroadcast(id, payload);
          })
          .on("broadcast", { event: "chat_activity" }, () => {
            // Wakes conversation previews and unread badges through the one
            // coalesced group refresh; never a per-event query burst.
            void refreshGroup(id).catch(() => {});
          })
          .subscribe(
            onRecovery(() => {
              void refreshGroup(id).catch(() => {});
            }),
          );
        channels.set(id, ch);
      }
    }

    const meId = useAppStore.getState().me?.id ?? null;
    if (meId !== userChannelUserId) {
      if (userChannel) {
        void getSupabase().removeChannel(userChannel);
        userChannel = null;
      }
      userChannelUserId = meId;
      if (meId) {
        userChannel = getSupabase()
          .channel(`user:${meId}`, { config: { private: true } })
          .on("broadcast", { event: "membership" }, ({ payload }) => {
            handleMembershipBroadcast(payload);
          })
          .subscribe(
            onRecovery(() => {
              void refreshMemberships().catch(() => {});
            }),
          );
      }
    }
  }

  let lastOrder = useAppStore.getState().groupOrder;
  let lastMeId = useAppStore.getState().me?.id ?? null;

  const unsubscribe = useAppStore.subscribe((state) => {
    const nextMeId = state.me?.id ?? null;
    if (state.groupOrder !== lastOrder || nextMeId !== lastMeId) {
      lastOrder = state.groupOrder;
      lastMeId = nextMeId;
      syncChannels();
    }
  });

  syncChannels();

  return () => {
    unsubscribe();
    if (userChannel) {
      void getSupabase().removeChannel(userChannel);
    }
    userChannel = null;
    userChannelUserId = null;
    for (const ch of channels.values()) {
      void getSupabase().removeChannel(ch);
    }
    channels.clear();
  };
}

export function subscribeChat(groupId: string): () => void {
  const channel = getSupabase()
    .channel(`chat:${groupId}`, { config: { private: true } })
    .on("broadcast", { event: "message" }, ({ payload }) => {
      handleChatBroadcast(groupId, payload);
    })
    .subscribe((status) => {
      // Reconcile once the subscription is live: anything inserted before this
      // point was never broadcast to us.
      if (status === "SUBSCRIBED") reconcileChat(groupId);
    });

  const handleVisibility = () => {
    if (document.visibilityState === "visible") reconcileChat(groupId);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    // Invalidate before removing the channel so in-flight pages cannot publish.
    invalidateChatReconciliation(groupId);
    void getSupabase().removeChannel(channel);
  };
}
