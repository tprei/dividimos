import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_RE,
  canonicalizeRoomCode,
  generateRoomCode,
} from "./room-code";
import { ROOM_CODE_WORDS } from "./room-code-words";

describe("canonicalizeRoomCode", () => {
  it("canonicalizes case, accents, spaces and extra separators", () => {
    expect(canonicalizeRoomCode("Cafuné Legal")).toBe("cafune-legal");
    expect(canonicalizeRoomCode("  PIPOCA--moleza ")).toBe("pipoca-moleza");
  });

  it("rejects inputs that are not two words", () => {
    expect(canonicalizeRoomCode("pipoca")).toBeNull();
    expect(canonicalizeRoomCode("pipoca-moleza-caju")).toBeNull();
    expect(canonicalizeRoomCode("abc-12")).toBeNull();
  });
});

describe("ROOM_CODE_WORDS", () => {
  it("canonicalizes every word into a unique three-to-ten letter form", () => {
    const canonical = ROOM_CODE_WORDS.map((word) =>
      word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    );
    expect(canonical.length).toBe(3034);
    expect(canonical.every((word) => /^[a-z]{3,10}$/.test(word))).toBe(true);
    expect(new Set(canonical).size).toBe(3034);
  });
});

describe("generateRoomCode", () => {
  it("builds a canonical code from two list words", () => {
    const code = generateRoomCode();
    expect(code.canonical).toMatch(ROOM_CODE_RE);
    const [first, second, ...rest] = code.display.split("-");
    expect(rest).toEqual([]);
    expect(ROOM_CODE_WORDS).toContain(first);
    expect(ROOM_CODE_WORDS).toContain(second);
  });
});
