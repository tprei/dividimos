import type {
  AssignmentGroupTarget,
  AssignmentRoomCompletion,
  AssignmentRoomView,
  SetAssignmentClaimInput,
} from "@/types/assignment-room";
import type {
  ExpenseItemPayload,
  ExpensePayload,
  MutationAck,
} from "@/types/ledger";
import {
  decodeAnnounceAssignmentRoomResult,
  decodeAssignmentRoomCompletion,
  decodeAssignmentRoomGuestClaimResult,
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
} from "@/lib/ledger/decode-assignment-room";
import {
  useAssignmentRoomStore,
  type AssignmentRoomAttempt,
} from "@/stores/assignment-room-store";
import { useAppStore } from "@/stores/app-store";
import { getAuthGeneration, getSupabase, rpc } from "./client";
import { LedgerError, type LedgerErrorCode } from "./errors";
import { notify } from "./mutations";
import { refreshGroup } from "./refresh";

interface StoredRoomCredentials {
  joinToken?: string;
  memberToken?: string;
}

export interface CreateAssignmentRoomInput {
  groupTarget: AssignmentGroupTarget;
  header: {
    title: string;
    occurredOn: string;
    serviceFeeBasisPoints: number;
    fixedFeeCents: number;
  };
  items: ExpenseItemPayload[];
  participants: Array<{
    id: string;
    displayName: string;
    userId: string | null;
  }>;
}

export interface JoinAssignmentRoomInput {
  roomId: string;
  joinToken: string;
  displayName: string;
}

export interface EnterGroupAssignmentRoomInput {
  groupId: string;
  roomId: string;
}

export interface RemoveAssignmentRoomParticipantInput {
  roomId: string;
  participantId: string;
  expectedRevision: number;
}

export interface AssignmentRoomRevisionInput {
  roomId: string;
  expectedRevision: number;
}

export interface FinalizeAssignmentRoomInput extends AssignmentRoomRevisionInput {
  payload: ExpensePayload;
}

export interface FinalizeAssignmentRoomOutput {
  room: AssignmentRoomView;
  ack: MutationAck;
}

const CREDENTIAL_PREFIX = "dividimos.assignment-room.";
const JOIN_TOKEN = /^armj1_[A-Za-z0-9_-]{43}$/;
const MEMBER_TOKEN = /^armm1_[A-Za-z0-9_-]{43}$/;
const topics = new Map<string, string>();

const ENTER_REFRESH_GROUP_CODES: Partial<Record<LedgerErrorCode, true>> = {
  invalid_token: true,
  not_a_member: true,
  room_closed: true,
  room_cancelled: true,
  room_not_found: true,
};

function storage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new LedgerError("invalid_token");
  }
  return window.localStorage;
}

function credentialKey(roomId: string): string {
  return `${CREDENTIAL_PREFIX}${roomId}`;
}

function readCredentials(roomId: string): StoredRoomCredentials {
  let raw: string | null;
  try {
    raw = storage().getItem(credentialKey(roomId));
  } catch (cause) {
    throw new LedgerError("invalid_token", { cause });
  }
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    return {
      joinToken:
        typeof record.joinToken === "string" && JOIN_TOKEN.test(record.joinToken)
          ? record.joinToken
          : undefined,
      memberToken:
        typeof record.memberToken === "string" && MEMBER_TOKEN.test(record.memberToken)
          ? record.memberToken
          : undefined,
    };
  } catch {
    return {};
  }
}

function writeCredentials(roomId: string, value: StoredRoomCredentials): void {
  try {
    if (value.joinToken === undefined && value.memberToken === undefined) {
      storage().removeItem(credentialKey(roomId));
      return;
    }
    storage().setItem(credentialKey(roomId), JSON.stringify(value));
  } catch (cause) {
    throw new LedgerError("invalid_token", { cause });
  }
}

export function clearAllAssignmentRoomCredentials(): void {
  try {
    const roomStorage = storage();
    const keys: string[] = [];
    for (let index = 0; index < roomStorage.length; index += 1) {
      const key = roomStorage.key(index);
      if (key?.startsWith(CREDENTIAL_PREFIX)) keys.push(key);
    }
    for (const key of keys) roomStorage.removeItem(key);
  } catch {
    // Credential cleanup is best effort when browser storage is unavailable.
  }
}

function randomToken(prefix: "armj1" | "armm1"): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new LedgerError("invalid_token");
  try {
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    if (encoded.length !== 43) throw new Error("invalid credential length");
    return `${prefix}_${encoded}`;
  } catch (cause) {
    throw new LedgerError("invalid_token", { cause });
  }
}

function randomRoomId(): string {
  if (!globalThis.crypto?.randomUUID) throw new LedgerError("invalid_token");
  return globalThis.crypto.randomUUID();
}

function rememberTransport(view: AssignmentRoomView): void {
  const topic = view.room.topic;
  if (topic) topics.set(view.room.id, topic);
}

function publish(
  view: AssignmentRoomView,
  attempt: AssignmentRoomAttempt,
  authGeneration: number
): boolean {
  const store = useAssignmentRoomStore.getState();
  if (getAuthGeneration() !== authGeneration || !store.isCurrent(view.room.id, attempt)) {
    return false;
  }
  rememberTransport(view);
  return store.install(view, attempt);
}

function errorCode(error: unknown) {
  return error instanceof LedgerError ? error.code : "unknown";
}

async function mutateRoom(
  roomId: string,
  request: () => Promise<AssignmentRoomView>
): Promise<AssignmentRoomView> {
  const store = useAssignmentRoomStore.getState();
  const attempt = store.capture(roomId);
  const authGeneration = getAuthGeneration();
  try {
    const view = await request();
    publish(view, attempt, authGeneration);
    return view;
  } catch (error) {
    if (
      error instanceof LedgerError &&
      (error.code === "stale_version" || error.code === "item_unavailable")
    ) {
      await refreshAssignmentRoom(roomId).catch(() => undefined);
    }
    throw error;
  }
}

export function getAssignmentRoomTopic(roomId: string): string | null {
  return topics.get(roomId) ?? null;
}


export function getAssignmentRoomJoinToken(roomId: string): string | null {
  return readCredentials(roomId).joinToken ?? null;
}
export function getAssignmentRoomMemberToken(roomId: string): string | null {
  return readCredentials(roomId).memberToken ?? null;
}

/**
 * Presentation-only identity for the public join form: the room screen needs
 * to know whether the visitor already has a Dividimos account so it can hide
 * the guest-name field. The join RPC itself still identifies the actor through
 * `auth.uid()`; this never authorizes anything.
 */
export async function getAssignmentRoomJoinAccount(): Promise<{ id: string } | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  const user = data.session?.user ?? null;
  return user ? { id: user.id } : null;
}

function forgetAssignmentRoomCredentials(roomId: string): void {
  topics.delete(roomId);
  writeCredentials(roomId, {});
}

function forgetAssignmentRoomJoinToken(roomId: string): void {
  const memberToken = readCredentials(roomId).memberToken;
  writeCredentials(roomId, memberToken ? { memberToken } : {});
}

function forgetAssignmentRoomMemberToken(roomId: string): void {
  const joinToken = readCredentials(roomId).joinToken;
  writeCredentials(roomId, joinToken ? { joinToken } : {});
}

export function clearAssignmentRoomAccess(roomId: string): void {
  try {
    forgetAssignmentRoomCredentials(roomId);
  } finally {
    useAssignmentRoomStore.getState().remove(roomId);
  }
}

export function resetAssignmentRoomRuntime(): void {
  topics.clear();
  useAssignmentRoomStore.getState().reset();
}

function mayBeLostResponse(error: unknown): boolean {
  return (
    error instanceof LedgerError &&
    (error.code === "network" || error.code === "unknown")
  );
}

export async function announceAssignmentRoom(roomId: string): Promise<void> {
  const result = await rpc(
    "announce_assignment_room",
    { p_room_id: roomId },
    decodeAnnounceAssignmentRoomResult
  );
  notify(result.eventId);
}

function announceRoomToGroup(
  input: CreateAssignmentRoomInput,
  view: AssignmentRoomView
): void {
  if (input.groupTarget.kind !== "existing") return;
  void announceAssignmentRoom(view.room.id).catch(() => undefined);
}

export async function createAssignmentRoom(
  input: CreateAssignmentRoomInput
): Promise<AssignmentRoomView> {
  const roomId = randomRoomId();
  const joinToken = randomToken("armj1");
  writeCredentials(roomId, { joinToken });
  const attempt = useAssignmentRoomStore.getState().beginRead(roomId);
  const authGeneration = getAuthGeneration();
  try {
    const view = await rpc(
      "create_assignment_room",
      {
        p_room_id: roomId,
        p_group_target: input.groupTarget,
        p_header: input.header,
        p_items: input.items,
        p_participants: input.participants,
        p_join_token: joinToken,
      },
      decodeAssignmentRoomView
    );
    publish(view, attempt, authGeneration);
    announceRoomToGroup(input, view);
    return view;
  } catch (error) {
    if (mayBeLostResponse(error)) {
      const recovered = await refreshAssignmentRoom(roomId).catch(() => null);
      if (recovered) {
        announceRoomToGroup(input, recovered);
        return recovered;
      }
      throw error;
    }
    clearAssignmentRoomAccess(roomId);
    throw error;
  }
}

export async function joinAssignmentRoom(
  input: JoinAssignmentRoomInput
): Promise<AssignmentRoomView> {
  if (!JOIN_TOKEN.test(input.joinToken)) throw new LedgerError("invalid_token");
  const existingMemberToken = readCredentials(input.roomId).memberToken;
  if (existingMemberToken) return refreshAssignmentRoomMember(input.roomId);
  const memberToken = randomToken("armm1");
  writeCredentials(input.roomId, { joinToken: input.joinToken, memberToken });
  const attempt = useAssignmentRoomStore.getState().beginRead(input.roomId);
  const authGeneration = getAuthGeneration();
  try {
    const view = await rpc(
      "join_assignment_room",
      {
        p_room_id: input.roomId,
        p_join_token: input.joinToken,
        p_member_token: memberToken,
        p_display_name: input.displayName,
      },
      decodeAssignmentRoomView
    );
    writeCredentials(input.roomId, { memberToken });
    publish(view, attempt, authGeneration);
    return view;
  } catch (error) {
    if (mayBeLostResponse(error)) {
      const recovered = await refreshAssignmentRoomMember(input.roomId).catch(
        () => null
      );
      if (recovered) {
        writeCredentials(input.roomId, { memberToken });
        return recovered;
      }
      throw error;
    }
    clearAssignmentRoomAccess(input.roomId);
    throw error;
  }
}

export async function enterGroupAssignmentRoom(
  input: EnterGroupAssignmentRoomInput
): Promise<void> {
  const authGeneration = getAuthGeneration();
  const markJoined = () => {
    if (getAuthGeneration() !== authGeneration) return;
    useAppStore
      .getState()
      .markOpenAssignmentRoomJoined(input.groupId, input.roomId);
  };
  const existingMemberToken = readCredentials(input.roomId).memberToken;
  if (existingMemberToken) {
    try {
      await rpc(
        "refresh_assignment_room_member",
        { p_room_id: input.roomId, p_member_token: existingMemberToken },
        decodeAssignmentRoomView
      );
      markJoined();
      return;
    } catch (error) {
      if (!(error instanceof LedgerError && error.code === "invalid_token")) {
        throw error;
      }
      forgetAssignmentRoomMemberToken(input.roomId);
    }
  }
  const memberToken = randomToken("armm1");
  writeCredentials(input.roomId, {
    ...readCredentials(input.roomId),
    memberToken,
  });
  try {
    await rpc(
      "enter_group_assignment_room",
      { p_room_id: input.roomId, p_member_token: memberToken },
      decodeAssignmentRoomView
    );
    writeCredentials(input.roomId, {
      ...readCredentials(input.roomId),
      memberToken,
    });
    markJoined();
  } catch (error) {
    if (
      error instanceof LedgerError &&
      ENTER_REFRESH_GROUP_CODES[error.code] === true
    ) {
      void refreshGroup(input.groupId).catch(() => undefined);
    }
    if (mayBeLostResponse(error)) {
      const recovered = await rpc(
        "refresh_assignment_room_member",
        { p_room_id: input.roomId, p_member_token: memberToken },
        decodeAssignmentRoomView
      ).catch(() => null);
      if (recovered !== null) {
        writeCredentials(input.roomId, {
          ...readCredentials(input.roomId),
          memberToken,
        });
        markJoined();
        return;
      }
      throw error;
    }
    forgetAssignmentRoomMemberToken(input.roomId);
    throw error;
  }
}

async function readRoom(
  roomId: string,
  refreshMember: boolean
): Promise<AssignmentRoomView> {
  const store = useAssignmentRoomStore.getState();
  const attempt = store.beginRead(roomId);
  const authGeneration = getAuthGeneration();
  try {
    const memberToken = readCredentials(roomId).memberToken ?? null;
    const view = refreshMember
      ? await rpc(
          "refresh_assignment_room_member",
          { p_room_id: roomId, p_member_token: memberToken ?? "" },
          decodeAssignmentRoomView
        )
      : await rpc(
          "get_assignment_room",
          { p_room_id: roomId, p_member_token: memberToken as string },
          decodeAssignmentRoomView
        );
    publish(view, attempt, authGeneration);
    return view;
  } catch (error) {
    if (error instanceof LedgerError && error.code === "invalid_token") {
      clearAssignmentRoomAccess(roomId);
    } else {
      useAssignmentRoomStore.getState().fail(roomId, errorCode(error), attempt);
    }
    throw error;
  }
}

export function refreshAssignmentRoom(roomId: string): Promise<AssignmentRoomView> {
  return readRoom(roomId, false);
}

export function refreshAssignmentRoomMember(roomId: string): Promise<AssignmentRoomView> {
  if (!readCredentials(roomId).memberToken) {
    return Promise.reject(new LedgerError("invalid_token"));
  }

  return readRoom(roomId, true);
}
export async function refreshAssignmentRoomCompletion(
  roomId: string,
): Promise<AssignmentRoomCompletion> {
  const completion = await rpc(
    "get_assignment_room_completion",
    { p_room_id: roomId, p_member_token: readCredentials(roomId).memberToken },
    decodeAssignmentRoomCompletion,
  );
  return completion;
}

export async function claimAssignmentRoomGuest(roomId: string): Promise<MutationAck> {
  const memberToken = readCredentials(roomId).memberToken;
  if (!memberToken) throw new LedgerError("invalid_token");
  const authGeneration = getAuthGeneration();
  const ack = await rpc(
    "claim_assignment_room_guest",
    { p_room_id: roomId, p_member_token: memberToken },
    decodeAssignmentRoomGuestClaimResult,
  );
  if (getAuthGeneration() === authGeneration) {
    await Promise.all([refreshGroup(ack.groupId), refreshAssignmentRoom(roomId)]);
  }
  return ack;
}

export async function setAssignmentRoomClaim(
  input: SetAssignmentClaimInput
): Promise<AssignmentRoomView> {
  const store = useAssignmentRoomStore.getState();
  if (!store.beginItemMutation(input.roomId, input.itemId)) {
    throw new LedgerError("item_unavailable");
  }
  try {
    return await mutateRoom(input.roomId, () =>
      rpc(
        "set_assignment_room_claim",
        {
          p_room_id: input.roomId,
          p_member_token: (readCredentials(input.roomId).memberToken ?? null) as string,
          p_item_id: input.itemId,
          p_participant_id: input.participantId,
          p_expected_item_revision: input.expectedItemRevision,
          p_ticks: input.ticks,
        },
        decodeAssignmentRoomView
      )
    );
  } finally {
    useAssignmentRoomStore.getState().endItemMutation(input.roomId, input.itemId);
  }
}

export async function rotateAssignmentRoomJoin(
  roomId: string
): Promise<AssignmentRoomView> {
  const credentials = readCredentials(roomId);
  const joinToken = randomToken("armj1");
  writeCredentials(roomId, { ...credentials, joinToken });
  try {
    return await mutateRoom(roomId, () =>
      rpc(
        "rotate_assignment_room_join",
        { p_room_id: roomId, p_join_token: joinToken },
        decodeAssignmentRoomView
      )
    );
  } catch (error) {
    if (mayBeLostResponse(error)) {
      const recovered = await refreshAssignmentRoom(roomId).catch(() => null);
      if (recovered) return recovered;
      throw error;
    }
    writeCredentials(roomId, credentials);
    throw error;
  }
}

export async function removeAssignmentRoomParticipant(
  input: RemoveAssignmentRoomParticipantInput
): Promise<AssignmentRoomView> {
  const credentials = readCredentials(input.roomId);
  const joinToken = randomToken("armj1");
  writeCredentials(input.roomId, { ...credentials, joinToken });
  try {
    return await mutateRoom(input.roomId, () =>
      rpc(
        "remove_assignment_room_participant",
        {
          p_room_id: input.roomId,
          p_participant_id: input.participantId,
          p_expected_revision: input.expectedRevision,
          p_join_token: joinToken,
        },
        decodeAssignmentRoomView
      )
    );
  } catch (error) {
    if (mayBeLostResponse(error)) {
      const recovered = await refreshAssignmentRoom(input.roomId).catch(() => null);
      if (recovered) return recovered;
      throw error;
    }
    writeCredentials(input.roomId, credentials);
    throw error;
  }
}

export function closeAssignmentRoom(
  input: AssignmentRoomRevisionInput
): Promise<AssignmentRoomView> {
  return mutateRoom(input.roomId, () =>
    rpc(
      "close_assignment_room",
      { p_room_id: input.roomId, p_expected_revision: input.expectedRevision },
      decodeAssignmentRoomView
    )
  );
}

export async function cancelAssignmentRoom(
  input: AssignmentRoomRevisionInput
): Promise<AssignmentRoomView> {
  const view = await mutateRoom(input.roomId, () =>
    rpc(
      "cancel_assignment_room",
      { p_room_id: input.roomId, p_expected_revision: input.expectedRevision },
      decodeAssignmentRoomView
    )
  );
  forgetAssignmentRoomCredentials(input.roomId);
  return view;
}

export async function finalizeAssignmentRoom(
  input: FinalizeAssignmentRoomInput
): Promise<FinalizeAssignmentRoomOutput> {
  const attempt = useAssignmentRoomStore.getState().capture(input.roomId);
  const authGeneration = getAuthGeneration();
  const result = await rpc(
    "finalize_assignment_room",
    {
      p_room_id: input.roomId,
      p_expected_revision: input.expectedRevision,
      p_payload: input.payload,
    },
    decodeFinalizeAssignmentRoomResult
  );
  publish(result.room, attempt, authGeneration);
  try {
    forgetAssignmentRoomJoinToken(input.roomId);
  } catch {
    // The recorded room remains valid when browser storage is unavailable.
  }
  if (getAuthGeneration() === authGeneration) await refreshGroup(result.ack.groupId);
  return result;
}
