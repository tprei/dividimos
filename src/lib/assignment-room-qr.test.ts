import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSIGNMENT_ROOM_JOIN_TOKEN_RE,
  buildAssignmentRoomUrl,
  parseAssignmentRoomQrCode,
} from "./assignment-room-qr";

const ROOM_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = `armj1_${"a".repeat(43)}`;
const PATH = `/room/${ROOM_ID}#${TOKEN}`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ASSIGNMENT_ROOM_JOIN_TOKEN_RE", () => {
  it("accepts only the exact room join credential shape", () => {
    expect(ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(`armj1_${"a".repeat(42)}`)).toBe(
      false
    );
    expect(ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(`armj1_${"a".repeat(44)}`)).toBe(
      false
    );
    expect(ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(`armm1_${"a".repeat(43)}`)).toBe(
      false
    );
    expect(ASSIGNMENT_ROOM_JOIN_TOKEN_RE.test(`armj1_${"+".repeat(43)}`)).toBe(
      false
    );
  });
});

describe("parseAssignmentRoomQrCode", () => {
  it("accepts canonical production and relative fragment URLs", () => {
    expect(
      parseAssignmentRoomQrCode(`https://www.dividimos.ai${PATH}`)
    ).toEqual({
      roomId: ROOM_ID,
      token: TOKEN,
      url: PATH,
    });
    expect(parseAssignmentRoomQrCode(PATH)).toEqual({
      roomId: ROOM_ID,
      token: TOKEN,
      url: PATH,
    });
  });

  it("accepts loopback origins with explicit ports outside production", () => {
    expect(parseAssignmentRoomQrCode(`http://localhost:3000${PATH}`)).toEqual({
      roomId: ROOM_ID,
      token: TOKEN,
      url: PATH,
    });
    expect(parseAssignmentRoomQrCode(`http://127.0.0.1:3000${PATH}`)).toEqual({
      roomId: ROOM_ID,
      token: TOKEN,
      url: PATH,
    });
  });

  it("normalizes an uppercase canonical UUID", () => {
    const upper = ROOM_ID.toUpperCase();
    expect(parseAssignmentRoomQrCode(`/room/${upper}#${TOKEN}`)).toEqual({
      roomId: ROOM_ID,
      token: TOKEN,
      url: PATH,
    });
  });

  it.each([
    `https://evil.example/room/${ROOM_ID}#${TOKEN}`,
    `http://localhost/room/${ROOM_ID}#${TOKEN}`,
    `https://user:pass@www.dividimos.ai/room/${ROOM_ID}#${TOKEN}`,
    `/room/${ROOM_ID}/extra#${TOKEN}`,
    `/rooms/${ROOM_ID}#${TOKEN}`,
    `/room/not-a-uuid#${TOKEN}`,
    `/room/00000000-0000-0000-0000-000000000000#${TOKEN}`,
    `/room/${ROOM_ID}?token=${TOKEN}`,
    `/room/${ROOM_ID}?x=1#${TOKEN}`,
    `/room/${ROOM_ID}/${TOKEN}`,
    `/room/${ROOM_ID}#armj1_short`,
    `/room/${ROOM_ID}#${`armj1_${"+".repeat(43)}`}`,
    `/room/${ROOM_ID}`,
    TOKEN,
    "not a url",
  ])("rejects malformed or unsafe input %s", (value) => {
    expect(parseAssignmentRoomQrCode(value)).toBeNull();
  });

  it.each([
    ` ${PATH}`,
    `${PATH} `,
    `${PATH}\n`,
    `/room/${ROOM_ID}#armj1_${"a".repeat(42)}\u00a0`,
  ])("rejects any raw whitespace %s", (value) => {
    expect(parseAssignmentRoomQrCode(value)).toBeNull();
  });

  it("rejects loopback origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      parseAssignmentRoomQrCode(`http://localhost:3000${PATH}`)
    ).toBeNull();
  });
});

describe("buildAssignmentRoomUrl", () => {
  it("uses the production origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildAssignmentRoomUrl(ROOM_ID, TOKEN)).toBe(
      `https://www.dividimos.ai${PATH}`
    );
  });

  it("uses the current origin outside production", () => {
    expect(buildAssignmentRoomUrl(ROOM_ID, TOKEN)).toBe(
      `${window.location.origin}${PATH}`
    );
  });

  it("fails closed for malformed room IDs and tokens", () => {
    expect(() => buildAssignmentRoomUrl("not-a-uuid", TOKEN)).toThrow(
      "Invalid assignment room URL input"
    );
    expect(() => buildAssignmentRoomUrl(ROOM_ID, "armj1_short")).toThrow(
      "Invalid assignment room URL input"
    );
  });
});
