import { useAppStore } from "@/stores/app-store";
import type { PageCursor, Conversation } from "@/types/ledger";
import { getAuthGeneration } from "./client";
import { loadConversation, refreshGroup } from "./refresh";

/**
 * Chat history reconciliation.
 *
 * A live subscription only delivers rows that arrive after it is established,
 * so anything inserted before the first query, during a dropped connection, or
 * while the tab was suspended is missing. Reconciliation pages the
 * authoritative history backwards until it provably meets what is already
 * known, then publishes the result. A head page alone is never treated as the
 * whole history: an empty cache walks each stream to its bottom.
 */

interface Run {
  /** Bumped for every run so a late page cannot publish over a newer one. */
  requestGeneration: number;
  authGeneration: number;
  subscriptionGeneration: number;
  cancelled: boolean;
}

interface GroupRuns {
  active: Run | null;
  /** A hint that arrived while a run was in flight; re-runs once it settles. */
  dirty: boolean;
  subscriptionGeneration: number;
}

const runs = new Map<string, GroupRuns>();
let requestCounter = 0;

function entryFor(groupId: string): GroupRuns {
  const existing = runs.get(groupId);
  if (existing !== undefined) return existing;
  const created: GroupRuns = { active: null, dirty: false, subscriptionGeneration: 0 };
  runs.set(groupId, created);
  return created;
}

/**
 * Invalidates in-flight work for a group. Called before a channel is removed
 * so a page still in flight cannot publish into a torn-down subscription.
 */
export function invalidateChatReconciliation(groupId: string): void {
  const entry = runs.get(groupId);
  if (entry === undefined) return;
  entry.subscriptionGeneration += 1;
  entry.dirty = false;
  if (entry.active !== null) entry.active.cancelled = true;
  entry.active = null;
}

function isCurrent(groupId: string, run: Run): boolean {
  const entry = runs.get(groupId);
  return (
    entry !== undefined &&
    !run.cancelled &&
    entry.active?.requestGeneration === run.requestGeneration &&
    entry.subscriptionGeneration === run.subscriptionGeneration &&
    getAuthGeneration() === run.authGeneration
  );
}

/**
 * True when this page reaches history that is already known, so paging can
 * stop. Each stream is judged on its own rows: overlap in one stream says
 * nothing about the other.
 */
function reachesKnownMessages(
  messages: readonly Conversation["messages"][number][],
  knownOldestMessage: string | null,
  watermark: string | null,
): boolean {
  if (messages.length === 0) {
    return knownOldestMessage !== null || watermark !== null;
  }
  const oldest = messages[messages.length - 1];
  if (oldest === undefined) return false;
  return (
    (knownOldestMessage !== null && oldest.id === knownOldestMessage) ||
    (watermark !== null && oldest.id === watermark)
  );
}

function reachesKnownEvents(
  events: readonly Conversation["events"][number][],
  knownOldestEventId: number | null,
): boolean {
  if (events.length === 0) return knownOldestEventId !== null;
  const oldest = events[events.length - 1];
  return (
    oldest !== undefined &&
    knownOldestEventId !== null &&
    oldest.id === knownOldestEventId
  );
}

async function runReconciliation(groupId: string, run: Run): Promise<void> {
  const store = useAppStore.getState();
  const before = store.conversations[groupId];
  const knownOldestMessage = before?.messages[0]?.id ?? null;
  const knownOldestEventId = before?.events[0]?.id ?? null;
  const watermark = before?.readWatermark?.lastReadMessageId ?? null;

  store.setConversationReconcile(groupId, "loading");

  let messageBefore: PageCursor | null = null;
  let eventBefore: PageCursor | null = null;
  let firstPage = true;
  let messagesSettled = false;
  let eventsSettled = false;

  for (;;) {
    if (!isCurrent(groupId, run)) return;

    const page: Conversation | null = firstPage
      ? await loadConversation(groupId)
      : await loadConversation(groupId, { messageBefore, eventBefore });
    if (page === null || !isCurrent(groupId, run)) return;
    firstPage = false;

    messagesSettled =
      messagesSettled ||
      page.messagesComplete ||
      page.messageCursor === null ||
      reachesKnownMessages(page.messages, knownOldestMessage, watermark);
    eventsSettled =
      eventsSettled ||
      page.eventsComplete ||
      page.eventCursor === null ||
      reachesKnownEvents(page.events, knownOldestEventId);

    if (messagesSettled && eventsSettled) break;

    messageBefore = messagesSettled ? null : page.messageCursor;
    eventBefore = eventsSettled ? null : page.eventCursor;
    if (!messagesSettled && messageBefore === null) messagesSettled = true;
    if (!eventsSettled && eventBefore === null) eventsSettled = true;
  }

  if (!isCurrent(groupId, run)) return;
  useAppStore.getState().setConversationReconcile(groupId, "ready");
  void refreshGroup(groupId).catch(() => {});
}

/**
 * Starts reconciliation for a group, coalescing repeated hints into one run
 * plus a single follow-up. A failure leaves the previously known rows, cursors
 * and read eligibility untouched.
 */
export function reconcileChat(groupId: string): void {
  const entry = entryFor(groupId);
  if (entry.active !== null) {
    entry.dirty = true;
    return;
  }

  requestCounter += 1;
  const run: Run = {
    requestGeneration: requestCounter,
    authGeneration: getAuthGeneration(),
    subscriptionGeneration: entry.subscriptionGeneration,
    cancelled: false,
  };
  entry.active = run;

  void runReconciliation(groupId, run)
    .catch(() => {
      if (isCurrent(groupId, run)) {
        useAppStore.getState().setConversationReconcile(groupId, "error");
      }
    })
    .finally(() => {
      const current = runs.get(groupId);
      if (current === undefined || current.active?.requestGeneration !== run.requestGeneration) {
        return;
      }
      current.active = null;
      if (current.dirty) {
        current.dirty = false;
        reconcileChat(groupId);
      }
    });
}

/**
 * A broadcast row older than the oldest row we hold means the local history
 * has a hole the live stream cannot fill.
 */
export function isMalformedHint(groupId: string, createdAt: string): boolean {
  const conversation = useAppStore.getState().conversations[groupId];
  const oldest = conversation?.messages[0];
  if (oldest === undefined) return false;
  return createdAt < oldest.createdAt && !conversation.messagesComplete;
}

/** Test seam: drops all per-group reconciliation bookkeeping. */
export function resetChatReconciliation(): void {
  runs.clear();
  requestCounter = 0;
}
