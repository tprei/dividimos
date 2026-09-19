import type { ValidationResult } from "@/lib/expense-money";
import {
  decodeGroupSnapshot,
  decodeMe,
  decodeUserProfile,
  type Path,
} from "@/lib/ledger/decode";
import type {
  Bootstrap,
  GroupAvatar,
  GroupOverviewData,
  GroupSnapshot,
  GroupSpending,
  GroupSpendingRow,
  WireIssue,
} from "@/types/ledger";
import {
  arrayOf,
  exactKeys,
  fail,
  id,
  isRecord,
  ok,
  oneOf,
  str,
} from "@/lib/ledger/decode-expense";

const GROUP_OVERVIEW_KEYS = ["snapshot", "overview"] as const;
const GROUP_OVERVIEW_DATA_KEYS = ["avatar", "spending"] as const;
const GROUP_AVATAR_INITIALS_KEYS = ["kind"] as const;
const GROUP_AVATAR_EMOJI_KEYS = ["kind", "emoji"] as const;
const GROUP_AVATAR_PHOTO_KEYS = ["kind", "photoId"] as const;
const GROUP_SPENDING_KEYS = ["totalCents", "participants"] as const;
const GROUP_SPENDING_USER_KEYS = ["kind", "participantId", "user", "shareCents"] as const;
const GROUP_SPENDING_GUEST_KEYS = [
  "kind",
  "participantId",
  "displayName",
  "shareCents",
] as const;
const BOOTSTRAP_OVERVIEW_KEYS = ["me", "groups", "serverTime"] as const;
const GROUP_KINDS = ["initials", "emoji", "photo"] as const;

function nonnegativeSafeInteger(
  value: unknown,
  path: Path,
): ValidationResult<number, WireIssue> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? ok(value)
    : fail(path);
}

function decodeAvatar(raw: unknown, path: Path): ValidationResult<GroupAvatar, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const kind = oneOf(raw.kind, GROUP_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;

  if (kind.value === "initials") {
    const keys = exactKeys(raw, GROUP_AVATAR_INITIALS_KEYS, path);
    return keys.ok ? ok({ kind: "initials" }) : keys;
  }
  if (kind.value === "emoji") {
    const keys = exactKeys(raw, GROUP_AVATAR_EMOJI_KEYS, path);
    if (!keys.ok) return keys;
    const emoji = str(raw.emoji, [...path, "emoji"]);
    return emoji.ok ? ok({ kind: "emoji", emoji: emoji.value }) : emoji;
  }

  const keys = exactKeys(raw, GROUP_AVATAR_PHOTO_KEYS, path);
  if (!keys.ok) return keys;
  const photoId = id(raw.photoId, [...path, "photoId"]);
  return photoId.ok ? ok({ kind: "photo", photoId: photoId.value }) : photoId;
}

function decodeSpendingRow(
  raw: unknown,
  path: Path,
): ValidationResult<GroupSpendingRow, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const kind = oneOf(raw.kind, ["user", "guest"] as const, [...path, "kind"]);
  if (!kind.ok) return kind;
  const participantId = id(raw.participantId, [...path, "participantId"]);
  if (!participantId.ok) return participantId;
  const shareCents = nonnegativeSafeInteger(raw.shareCents, [...path, "shareCents"]);
  if (!shareCents.ok) return shareCents;

  if (kind.value === "user") {
    const keys = exactKeys(raw, GROUP_SPENDING_USER_KEYS, path);
    if (!keys.ok) return keys;
    const user = decodeUserProfile(raw.user, [...path, "user"]);
    return user.ok
      ? ok({ kind: "user", participantId: participantId.value, user: user.value, shareCents: shareCents.value })
      : user;
  }

  const keys = exactKeys(raw, GROUP_SPENDING_GUEST_KEYS, path);
  if (!keys.ok) return keys;
  const displayName = str(raw.displayName, [...path, "displayName"]);
  return displayName.ok
    ? ok({ kind: "guest", participantId: participantId.value, displayName: displayName.value, shareCents: shareCents.value })
    : displayName;
}

function decodeSpending(raw: unknown, path: Path): ValidationResult<GroupSpending, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, GROUP_SPENDING_KEYS, path);
  if (!keys.ok) return keys;
  const totalCents = nonnegativeSafeInteger(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const participants = arrayOf(raw.participants, [...path, "participants"], decodeSpendingRow);
  return participants.ok ? ok({ totalCents: totalCents.value, participants: participants.value }) : participants;
}

function decodeOverview(
  raw: unknown,
  path: Path,
): ValidationResult<GroupOverviewData, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, GROUP_OVERVIEW_DATA_KEYS, path);
  if (!keys.ok) return keys;
  const avatar = decodeAvatar(raw.avatar, [...path, "avatar"]);
  if (!avatar.ok) return avatar;
  if (raw.spending === null) return ok({ avatar: avatar.value, spending: null });
  const spending = decodeSpending(raw.spending, [...path, "spending"]);
  return spending.ok ? ok({ avatar: avatar.value, spending: spending.value }) : spending;
}

export function decodeGroupOverview(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupSnapshot, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, GROUP_OVERVIEW_KEYS, path);
  if (!keys.ok) return keys;
  const snapshot = decodeGroupSnapshot(raw.snapshot, [...path, "snapshot"]);
  if (!snapshot.ok) return snapshot;
  const overview = decodeOverview(raw.overview, [...path, "overview"]);
  return overview.ok ? ok({ ...snapshot.value, overview: overview.value }) : overview;
}


export function decodeBootstrapOverview(
  raw: unknown,
  path: Path = [],
): ValidationResult<Bootstrap, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, BOOTSTRAP_OVERVIEW_KEYS, path);
  if (!keys.ok) return keys;
  const me = decodeMe(raw.me, [...path, "me"]);
  if (!me.ok) return me;
  const groups = arrayOf(raw.groups, [...path, "groups"], decodeGroupOverview);
  if (!groups.ok) return groups;
  const serverTime = str(raw.serverTime, [...path, "serverTime"]);
  return serverTime.ok
    ? ok({ me: me.value, groups: groups.value, serverTime: serverTime.value })
    : serverTime;
}
