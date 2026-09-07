"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { ExpenseVersion } from "@/types/ledger";
import { describeVersion } from "./change-summary-copy";

interface ExpenseHistoryProps {
  versions: ExpenseVersion[];
  nameOf: (userId: string) => string;
  avatarUrlOf: (userId: string) => string | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const elapsed = Date.now() - date.getTime();
  if (elapsed < MINUTE_MS) return "agora";
  if (elapsed < HOUR_MS) return `há ${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `há ${Math.floor(elapsed / HOUR_MS)} h`;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

export function ExpenseHistory({
  versions,
  nameOf,
  avatarUrlOf,
}: ExpenseHistoryProps) {
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold">Histórico</h2>
      <ol className="space-y-2">
        {ordered.map((v) => {
          const author = nameOf(v.authorId);
          return (
            <li
              key={v.versionNo}
              className="rounded-xl border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={author}
                  avatarUrl={avatarUrlOf(v.authorId)}
                  size="sm"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{author}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTimestamp(v.createdAt)}
                  </p>
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {describeVersion(v, { authorName: author, nameOf }).map(
                  (sentence) => (
                    <li key={sentence} className="text-sm text-muted-foreground">
                      {sentence}
                    </li>
                  ),
                )}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
