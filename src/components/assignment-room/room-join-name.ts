export function roomJoinFirstName(name: string | null): string | null {
  const firstWord = name?.trim().split(/\s+/, 1)[0];
  if (!firstWord) return null;
  const cleaned = firstWord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}]+$/gu, "");
  return cleaned || null;
}
