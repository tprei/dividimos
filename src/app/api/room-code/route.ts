import { NextResponse } from "next/server";
import { ASSIGNMENT_ROOM_GRANT_TOKEN_RE } from "@/lib/assignment-room-qr";
import { AppError } from "@/lib/errors";
import { decodeAssignmentRoomCodeResolution } from "@/lib/ledger/decode-assignment-room";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ROOM_CODE_RE } from "@/lib/room-code";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  codeFromMessage,
  LedgerError,
  ledgerErrorMessage,
  type LedgerErrorCode,
} from "@/lib/sync/errors";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const STATUS: Partial<Record<LedgerErrorCode, number>> = {
  invalid_argument: 400,
  invalid_room_code: 404,
  room_code_rate_limited: 429,
  room_code_unavailable: 503,
};

function failure(code: LedgerErrorCode): Response {
  return NextResponse.json(
    { error: { code, message: ledgerErrorMessage(new LedgerError(code)) } },
    { status: STATUS[code] ?? 500, headers: NO_STORE },
  );
}

function ipv6Prefix64(address: string): string {
  const [head, tail] = address.toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function rateLimitSubject(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first?.includes(":") && !first.includes(".")) return `ip:${ipv6Prefix64(first)}`;
  if (first) return `ip:${first.slice(first.lastIndexOf(":") + 1)}`;
  if (process.env.NODE_ENV === "production") return null;
  return "ip:local";
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure("invalid_argument");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return failure("invalid_argument");
    }
    const record = body as Record<string, unknown>;
    const { code, grantToken } = record;
    if (typeof code !== "string" || typeof grantToken !== "string") {
      return failure("invalid_argument");
    }
    if (!ROOM_CODE_RE.test(code)) return failure("invalid_room_code");
    if (!ASSIGNMENT_ROOM_GRANT_TOKEN_RE.test(grantToken)) {
      return failure("invalid_argument");
    }

    const subject = rateLimitSubject(request);
    if (subject === null) return failure("room_code_unavailable");
    try {
      await enforceRateLimit("room-code.resolve", subject);
    } catch (limitError) {
      return failure(limitError instanceof AppError && limitError.code === "RATE_LIMIT_EXCEEDED"
        ? "room_code_rate_limited"
        : "room_code_unavailable");
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("resolve_assignment_room_code", {
      p_code: code,
      p_grant_token: grantToken,
    });
    if (error) return failure(codeFromMessage(error.message));

    const decoded = decodeAssignmentRoomCodeResolution(data);
    if (!decoded.ok) return failure("unknown");
    return NextResponse.json({ roomId: decoded.value.roomId }, { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof LedgerError)) {
      console.error("[room-code] unhandled route error", {
        code: "unknown",
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
    return failure(error instanceof LedgerError ? error.code : "unknown");
  }
}
