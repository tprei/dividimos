import type { RealtimeChannel } from "@supabase/supabase-js";
import { decodeChatMessage } from "@/lib/ledger/decode";
import { decodeAssignmentRoomSummary } from "@/lib/ledger/decode-assignment-room";
import { exactKeys, isRecord } from "@/lib/ledger/decode-expense";
import type { AssignmentRoomSummary } from "@/types/assignment-room";
import { useAppStore } from "@/stores/app-store";
import type { AppState } from "@/stores/app-store";
import { mergeConversation } from "@/stores/app-store-merge";
import {
  invalidateChatReconciliation,
  isMalformedHint,
  reconcileChat,
} from "./chat-reconcile";
import type { ChatMessage, GroupSnapshot } from "@/types/ledger";
import { catchUpBootstrap } from "./bootstrap";
import { getAuthGeneration, getSupabase } from "./client";
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

export function parseAssignmentRoomBroadcast(raw: unknown): AssignmentRoomSummary | null {
  if (!isRecord(raw)) return null;
  if (!exactKeys(raw, ["room"], [], ["id"]).ok) return null;
  const decoded = decodeAssignmentRoomSummary(raw.room);
  return decoded.ok ? decoded.value : null;
}

function handleAssignmentRoomBroadcast(
  groupId: string,
  payload: unknown,
  authGeneration: number,
): void {
  if (getAuthGeneration() !== authGeneration) return;
  const room = parseAssignmentRoomBroadcast(payload);
  if (room === null || room.groupId !== groupId) return;
  useAppStore.getState().applyAssignmentRoomSummaries([room]);
}

function handleChatBroadcast(
  groupId: string,
  payload: unknown,
  authGeneration: number,
): void {
  if (getAuthGeneration() !== authGeneration) return;
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

function catchUpMemberships(): void {
  void catchUpBootstrap().catch(() => {});
}

function handleMembershipBroadcast(payload: unknown): void {
  if (!parseMembershipPayload(payload)) return;
  catchUpMemberships();
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

interface JoinPass {
  generation: number;
  pending: Set<symbol>;
  tokensByGroup: Map<string, symbol>;
  joinedGroupIds: Set<string>;
  joinedUser: boolean;
}

export function startRealtime(): () => void {
  const channels = new Map<string, RealtimeChannel>();
  let userChannel: RealtimeChannel | null = null;
  let userChannelUserId: string | null = null;
  let passes: JoinPass[] = [];
  let stopped = false;

  function settlePass(
    pass: JoinPass,
    token: symbol,
    subscribed: boolean,
    groupId: string | null,
  ): void {
    if (stopped || !pass.pending.delete(token)) return;
    if (subscribed) {
      if (groupId === null) pass.joinedUser = true;
      else pass.joinedGroupIds.add(groupId);
    }
    if (pass.pending.size > 0) return;
    passes = passes.filter((candidate) => candidate !== pass);
    if (getAuthGeneration() !== pass.generation) return;
    if (pass.joinedUser || pass.joinedGroupIds.size > 1) {
      catchUpMemberships();
      return;
    }
    const [only] = pass.joinedGroupIds;
    if (only !== undefined) void refreshGroup(only).catch(() => {});
  }

  function dropGroupFromPasses(groupId: string): void {
    for (const pass of passes) {
      const token = pass.tokensByGroup.get(groupId);
      if (token === undefined) continue;
      pass.tokensByGroup.delete(groupId);
      pass.joinedGroupIds.delete(groupId);
      settlePass(pass, token, false, null);
    }
  }

  function syncChannels(): void {
    passes = passes.filter((candidate) => candidate.generation === getAuthGeneration());
    const desiredIds = new Set(useAppStore.getState().groupOrder);

    for (const [id, ch] of channels) {
      if (!desiredIds.has(id)) {
        dropGroupFromPasses(id);
        void getSupabase().removeChannel(ch);
        channels.delete(id);
      }
    }

    // One catch-up per pass. Every channel created here reports a first status
    // (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, or CLOSED when removed), so a slow
    // channel delays only its own pass.
    const pass: JoinPass = {
      generation: getAuthGeneration(),
      pending: new Set(),
      tokensByGroup: new Map(),
      joinedGroupIds: new Set(),
      joinedUser: false,
    };

    for (const id of desiredIds) {
      if (channels.has(id)) continue;
      const token = Symbol();
      pass.pending.add(token);
      pass.tokensByGroup.set(id, token);
      const authGeneration = pass.generation;
      const handleRecovery = onRecovery(() => {
        void refreshGroup(id).catch(() => {});
      });
      const ch = getSupabase()
        .channel(`group:${id}`, { config: { private: true } })
        .on("broadcast", { event: "ledger" }, ({ payload }) => {
          handleLedgerBroadcast(id, payload);
        })
        .on("broadcast", { event: "assignment_room" }, ({ payload }) => {
          handleAssignmentRoomBroadcast(id, payload, authGeneration);
        })
        .on("broadcast", { event: "chat_activity" }, () => {
          // Wakes conversation previews and unread badges through the one
          // coalesced group refresh; never a per-event query burst.
          void refreshGroup(id).catch(() => {});
        })
        .subscribe((status) => {
          if (getAuthGeneration() !== authGeneration) return;
          handleRecovery(status);
          settlePass(pass, token, status === "SUBSCRIBED", id);
        });
      channels.set(id, ch);
    }

    const meId = useAppStore.getState().me?.id ?? null;
    if (meId !== userChannelUserId) {
      if (userChannel) {
        void getSupabase().removeChannel(userChannel);
        userChannel = null;
      }
      userChannelUserId = meId;
      if (meId) {
        const token = Symbol();
        pass.pending.add(token);
        const authGeneration = pass.generation;
        const handleRecovery = onRecovery(catchUpMemberships);
        userChannel = getSupabase()
          .channel(`user:${meId}`, { config: { private: true } })
          .on("broadcast", { event: "membership" }, ({ payload }) => {
            handleMembershipBroadcast(payload);
          })
          .subscribe((status) => {
            if (getAuthGeneration() !== authGeneration) return;
            handleRecovery(status);
            settlePass(pass, token, status === "SUBSCRIBED", null);
          });
      }
    }

    if (pass.pending.size > 0) passes.push(pass);
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
    stopped = true;
    passes = [];
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
  const authGeneration = getAuthGeneration();
  const channel = getSupabase()
    .channel(`chat:${groupId}`, { config: { private: true } })
    .on("broadcast", { event: "message" }, ({ payload }) => {
      handleChatBroadcast(groupId, payload, authGeneration);
    })
    .subscribe((status) => {
      // Reconcile once the subscription is live: anything inserted before this
      // point was never broadcast to us.
      if (status === "SUBSCRIBED" && getAuthGeneration() === authGeneration) {
        reconcileChat(groupId);
      }
    });

  const handleVisibility = () => {
    if (
      document.visibilityState === "visible" &&
      getAuthGeneration() === authGeneration
    ) {
      reconcileChat(groupId);
    }
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
