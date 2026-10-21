import type { UserProfile } from "@/types/ledger";

export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function matchPeople(people: readonly UserProfile[], query: string): UserProfile[] {
  const trimmed = query.trim();
  const handleOnly = trimmed.startsWith("@");
  const folded = foldForSearch(trimmed).replace(/^@/, "");
  const tokens = folded.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return [];

  const exact: UserProfile[] = [];
  const prefixed: UserProfile[] = [];
  for (const person of people) {
    const handle = foldForSearch(person.handle);
    const nameWords = handleOnly ? [] : foldForSearch(person.name).split(/\s+/);
    const matches = tokens.every(
      (token) =>
        handle.startsWith(token) || nameWords.some((word) => word.startsWith(token)),
    );
    if (!matches) continue;
    if (handle === folded) exact.push(person);
    else prefixed.push(person);
  }
  return [...exact, ...prefixed];
}

export type HandleQuery =
  | { kind: "none" }
  | { kind: "explicit"; handle: string }
  | { kind: "implicit"; handle: string };

export function parseHandleQuery(query: string): HandleQuery {
  const trimmed = query.trim();
  const explicit = trimmed.startsWith("@");
  const candidate = (explicit ? trimmed.slice(1) : trimmed).toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(candidate)) return { kind: "none" };
  if (explicit || /[_\d.]/.test(candidate)) {
    return { kind: "explicit", handle: candidate };
  }
  return { kind: "implicit", handle: candidate };
}
