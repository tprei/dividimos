import { PRODUCTION_CLAIM_ORIGIN } from "@/lib/claim-qr";
import { ROOM_CODE_WORDS } from "@/lib/room-code-words";

export const ROOM_CODE_RE = /^[a-z]{3,10}-[a-z]{3,10}$/;

export interface RoomCode {
  display: string;
  canonical: string;
}

export function canonicalRoomCodeWord(word: string): string {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function canonicalizeRoomCode(input: string): string | null {
  const canonical = canonicalRoomCodeWord(input)
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ROOM_CODE_RE.test(canonical) ? canonical : null;
}

function randomWord(): string {
  const count = ROOM_CODE_WORDS.length;
  const limit = Math.floor(0x1_0000_0000 / count) * count;
  const buffer = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return ROOM_CODE_WORDS[buffer[0] % count];
}

export function generateRoomCode(): RoomCode {
  const first = randomWord();
  const second = randomWord();
  return {
    display: `${first}-${second}`,
    canonical: `${canonicalRoomCodeWord(first)}-${canonicalRoomCodeWord(second)}`,
  };
}

export function roomCodeEntryAddress(): string {
  const origin =
    process.env.NODE_ENV === "production" ? PRODUCTION_CLAIM_ORIGIN : window.location.origin;
  return `${new URL(origin).host}/room`;
}
