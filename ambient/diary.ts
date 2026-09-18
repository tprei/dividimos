import { appendFileSync } from "node:fs";
import { join } from "node:path";

// Tests call note() as they act; the ambient reporter reads the resulting
// ambient-diary.txt after the run and posts each line as a fact in the
// Telegram summary. One fact per line, English, under 120 chars.
export function note(fact: string): void {
  appendFileSync(join(process.cwd(), "ambient-diary.txt"), `${fact}\n`, "utf8");
}

// Bots are seeded as "Ana (bot)"; the diary reads better with just "Ana".
export function firstName(bots: readonly { id: string; name: string }[], id: string): string {
  const bot = bots.find((candidate) => candidate.id === id);
  return (bot?.name ?? "A bot").replace(/ \(bot\)$/, "");
}
