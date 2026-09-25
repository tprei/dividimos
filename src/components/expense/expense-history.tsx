"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { ExpenseVersion } from "@/types/ledger";
import { describeVersion } from "./change-summary-copy";

interface ExpenseHistoryProps {
  versions: ExpenseVersion[];
  nameOf: (userId: string) => string;
  avatarUrlOf: (userId: string) => string | null;
  showHeading?: boolean;
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
  showHeading = true,
}: ExpenseHistoryProps) {
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  return (
    <section className={showHeading ? "mt-6" : undefined}>
      {showHeading && <h2 className="mb-3 text-lg font-semibold">Histórico</h2>}
      <ol className="ml-4 border-l border-border">
        {ordered.map((v) => {
          const author = nameOf(v.authorId);
          return (
            <li
              key={v.versionNo}
              className="relative pb-4 pl-6 last:pb-0"
            >
              <div className="flex items-center gap-3">
                <UserAvatar
                  id={v.authorId}
                  name={author}
                  avatarUrl={avatarUrlOf(v.authorId)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Versão {v.versionNo}</p>
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
