import { isAcceptedAppOrigin, PRODUCTION_CLAIM_ORIGIN } from "@/lib/claim-qr";

export const ASSIGNMENT_ROOM_JOIN_TOKEN_RE = /^armj1_[A-Za-z0-9_-]{43}$/;

const ROOM_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_PATH_RE =
  /^\/room\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const WHITESPACE_RE = /\s/;

export interface AssignmentRoomQrResult {
  roomId: string;
  token: string;
  url: string;
}

export function buildAssignmentRoomUrl(
  roomId: string,
  joinToken: string
): string {
  if (
    !ROOM_ID_RE.test(roomId) ||
    !ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(joinToken)
  ) {
    throw new Error("Invalid assignment room URL input");
  }

  const origin =
    process.env.NODE_ENV === "production"
      ? PRODUCTION_CLAIM_ORIGIN
      : window.location.origin;
  return `${origin}/room/${roomId.toLowerCase()}#${joinToken}`;
}

export function parseAssignmentRoomQrCode(
  value: string
): AssignmentRoomQrResult | null {
  if (WHITESPACE_RE.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, PRODUCTION_CLAIM_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "") return null;
  if (!isAcceptedAppOrigin(parsed.origin)) return null;

  const pathMatch = ROOM_PATH_RE.exec(parsed.pathname);
  if (!pathMatch || !parsed.hash.startsWith("#")) return null;

  const roomId = pathMatch[1]?.toLowerCase();
  const token = parsed.hash.slice(1);
  if (!roomId || !ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(token)) return null;

  return {
    roomId,
    token,
    url: `/room/${roomId}#${token}`,
  };
}
