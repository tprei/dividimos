"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";

export interface SplitSummaryRow {
  id: string;
  label: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  consumedCents: number;
  paidCents: number;
}

export function SplitSummary({ rows }: { rows: readonly SplitSummaryRow[] }) {
  return (
    <section aria-labelledby="split-summary-title" className="space-y-1.5">
      <h2 id="split-summary-title" className="px-1 text-xs font-semibold text-muted-foreground">
        Como fica
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-[0.75rem] border border-border bg-card">
        {rows.map((row) => {
          const net = row.paidCents - row.consumedCents;
          return (
            <li key={row.id} className="flex min-h-11 items-center gap-2.5 px-3 py-1.5">
              {row.isGuest ? (
                <GuestAvatar id={row.id} name={row.name} size="xs" />
              ) : (
                <UserAvatar id={row.id} name={row.name} avatarUrl={row.avatarUrl} size="xs" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>
                {row.label}
              </span>
              {net === 0 ? (
                <span className="shrink-0 text-sm text-muted-foreground">quite</span>
              ) : (
                <span className="shrink-0 text-sm text-muted-foreground">
                  {net > 0 ? "recebe " : "deve "}
                  <Money cents={Math.abs(net)} className="text-sm text-foreground" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
