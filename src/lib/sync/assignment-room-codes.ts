import {
  decodeAssignmentRoomCodeIssue,
  decodeAssignmentRoomCodeResolution,
} from "@/lib/ledger/decode-assignment-room";
import { canonicalizeRoomCode, generateRoomCode } from "@/lib/room-code";
import { randomToken } from "./assignment-rooms";
import { rpc } from "./client";
import { codeFromMessage, LedgerError } from "./errors";

export interface IssuedAssignmentRoomCode {
  display: string;
  expiresAt: string;
}

export interface ResolvedAssignmentRoomCode {
  roomId: string;
  grantToken: string;
}

export async function resolveAssignmentRoomCode(
  input: string
): Promise<ResolvedAssignmentRoomCode> {
  const code = canonicalizeRoomCode(input);
  if (code === null) throw new LedgerError("invalid_room_code");
  const grantToken = randomToken("armr1");
  let response: Response;
  try {
    response = await fetch("/api/room-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, grantToken }),
    });
  } catch (cause) {
    throw new LedgerError("network", { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new LedgerError("invalid_wire", { cause });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new LedgerError("invalid_wire");
  }
  if (!response.ok) {
    if ("error" in body && typeof body.error === "object" && body.error !== null &&
        "code" in body.error && typeof body.error.code === "string") {
      throw new LedgerError(codeFromMessage(body.error.code));
    }
    throw new LedgerError("invalid_wire");
  }
  const decoded = decodeAssignmentRoomCodeResolution(body);
  if (!decoded.ok) throw new LedgerError("invalid_wire", { cause: decoded.issue });
  return { roomId: decoded.value.roomId, grantToken };
}

export async function issueAssignmentRoomCode(
  roomId: string
): Promise<IssuedAssignmentRoomCode> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateRoomCode();
    const startedAt = Date.now();
    try {
      const { expiresInSeconds } = await rpc(
        "issue_assignment_room_code",
        { p_room_id: roomId, p_code: code.canonical },
        decodeAssignmentRoomCodeIssue
      );
      return {
        display: code.display,
        expiresAt: new Date(startedAt + expiresInSeconds * 1000).toISOString(),
      };
    } catch (error) {
      if (error instanceof LedgerError && error.code === "room_code_taken") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
