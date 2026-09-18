import { appendFileSync } from "node:fs";
import { join } from "node:path";

// Tests call note() as they act; the ambient reporter reads the resulting
// ambient-diary.txt after the run and posts each line as a fact in the
// Telegram summary. One fact per line, English, under 120 chars.
export function note(fact: string): void {
  appendFileSync(join(process.cwd(), "ambient-diary.txt"), `${fact}\n`, "utf8");
}
