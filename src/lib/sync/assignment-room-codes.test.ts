import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerError } from "./errors";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("./client", () => ({
  getAuthGeneration: () => 1,
  getSupabase: vi.fn(),
  rpc: mocks.rpc,
}));
vi.mock("./refresh", () => ({ refreshGroup: vi.fn() }));
vi.mock("./mutations", () => ({ notify: vi.fn() }));

import {
  issueAssignmentRoomCode,
  resolveAssignmentRoomCode,
} from "./assignment-room-codes";
import { ROOM_CODE_RE } from "@/lib/room-code";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const GRANT_RE = /^armr1_[A-Za-z0-9_-]{43}$/;

function fetchResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mocks.rpc.mockReset();
  vi.unstubAllGlobals();
});

describe("resolveAssignmentRoomCode", () => {
  it("rejects a non-canonicalizable code without fetching", async () => {
    const fetchMock = stubFetch();

    await expect(resolveAssignmentRoomCode("pipoca")).rejects.toMatchObject({
      code: "invalid_room_code",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an error body code to the same ledger error", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(
      fetchResponse(404, { error: { code: "invalid_room_code", message: "x" } })
    );

    await expect(resolveAssignmentRoomCode("Pipoca Moleza")).rejects.toMatchObject({
      code: "invalid_room_code",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const payload = JSON.parse(String(init.body)) as Record<string, string>;
    expect(payload.code).toBe("pipoca-moleza");
    expect(payload.grantToken).toMatch(GRANT_RE);
  });

  it("returns the resolved room with the minted grant", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(fetchResponse(200, { roomId: ROOM_ID }));

    const result = await resolveAssignmentRoomCode("  PIPOCA  moleza ");

    expect(result.roomId).toBe(ROOM_ID);
    expect(result.grantToken).toMatch(GRANT_RE);
  });
});

describe("issueAssignmentRoomCode", () => {
  it("retries twice on room_code_taken and then throws it", async () => {
    mocks.rpc.mockRejectedValue(new LedgerError("room_code_taken"));

    await expect(issueAssignmentRoomCode(ROOM_ID)).rejects.toMatchObject({
      code: "room_code_taken",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it("rethrows other failures without retrying", async () => {
    mocks.rpc.mockRejectedValue(new LedgerError("network"));

    await expect(issueAssignmentRoomCode(ROOM_ID)).rejects.toMatchObject({
      code: "network",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("expires the code by the server TTL measured from the local request start", async () => {
    mocks.rpc.mockImplementation(
      async (_name: string, _args: unknown, decode: (raw: unknown) => unknown) => {
        const decoded = decode({ expiresInSeconds: 900 }) as {
          ok: boolean;
          value?: { expiresInSeconds: number };
        };
        if (!decoded.ok) throw new Error("fixture failed decoding");
        return decoded.value;
      }
    );

    const before = Date.now();
    const issued = await issueAssignmentRoomCode(ROOM_ID);
    const after = Date.now();

    expect(mocks.rpc.mock.calls[0]?.[0]).toBe("issue_assignment_room_code");
    const args = mocks.rpc.mock.calls[0]?.[1] as { p_room_id: string; p_code: string };
    expect(args.p_room_id).toBe(ROOM_ID);
    expect(args.p_code).toMatch(ROOM_CODE_RE);
    const expiresAt = Date.parse(issued.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 900_000);
    const [first, second, ...rest] = issued.display.split("-");
    expect(rest).toEqual([]);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});
