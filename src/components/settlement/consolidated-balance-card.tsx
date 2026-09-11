import { useLayoutEffect, useRef, useState } from "react";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { BalanceRow } from "@/types/ledger";

export interface SettlementPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  /** Invited but has not accepted: `record_settlement` rejects them either way. */
  isPending: boolean;
}

interface ConsolidatedBalanceCardProps {
  balances: BalanceRow[];
  people: SettlementPerson[];
  debtsCount: number;
  pixCount: number;
}

type BalanceSide = "debt" | "credit";

function signedAmountLabel(cents: number): string {
  let prefix = "";
  if (cents < 0) prefix = "−";
  if (cents > 0) prefix = "+";
  return `${prefix}${formatBRL(Math.abs(cents))}`;
}


function segmentCenters(balances: BalanceRow[], total: number): number[] {
  const centers: number[] = [];
  let cumulative = 0;
  for (const balance of balances) {
    const width = Math.abs(balance.netCents);
    centers.push(((cumulative + width / 2) / total) * 100);
    cumulative += width;
  }
  return centers;
}

const AVATAR_DIAMETER = 24;
const AVATAR_GAP = 4;

export interface FanPlacement {
  index: number;
  x: number;
  row: number;
}

export function fanLayout(params: {
  centers: number[];
  laneWidth: number;
  diameter: number;
  gap: number;
}): FanPlacement[] {
  const { centers, laneWidth, diameter, gap } = params;
  const radius = diameter / 2;
  const step = diameter + gap;
  const upperBound = Math.max(radius, laneWidth - radius);
  const rowTails: number[] = [];
  const placements: FanPlacement[] = [];
  const order = centers
    .map((center, index) => ({ center, index }))
    .sort((a, b) => a.center - b.center || a.index - b.index);
  for (const { center, index } of order) {
    const desired = Math.min(Math.max(center, radius), upperBound);
    let row = rowTails.length;
    for (let candidate = 0; candidate < rowTails.length; candidate += 1) {
      if (Math.max(desired, rowTails[candidate] + step) <= upperBound) {
        row = candidate;
        break;
      }
    }
    const x =
      row < rowTails.length
        ? Math.max(desired, rowTails[row] + step)
        : desired;
    rowTails[row] = x;
    placements.push({ index, x, row });
  }
  return placements;
}

function PersonAvatar({
  person,
  className,
}: {
  person: SettlementPerson;
  className?: string;
}) {
  if (person.isGuest) {
    return <GuestAvatar size="xs" className={className} />;
  }
  return (
    <UserAvatar
      name={person.name}
      avatarUrl={person.avatarUrl}
      size="xs"
      className={className}
    />
  );
}

function ConsolidatedSide({
  balances,
  peopleById,
  totalCents,
  side,
}: {
  balances: BalanceRow[];
  peopleById: Map<string, SettlementPerson>;
  totalCents: number;
  side: BalanceSide;
}) {
  const resolved = balances.flatMap((balance) => {
    const person = peopleById.get(balance.participantId);
    return person ? [{ balance, person }] : [];
  });
  const total = Math.abs(totalCents);
  const isDebt = side === "debt";
  const accentClass = isDebt ? "bg-destructive/75" : "bg-success/75";
  const edgeClass = isDebt ? "rounded-l-full" : "rounded-r-full";
  const balanceKind = isDebt ? "Dívida" : "Crédito";
  const toneClass = isDebt ? "text-destructive" : "text-success";
  const gridTemplateColumns = resolved
    .map((entry) => `${Math.abs(entry.balance.netCents)}fr`)
    .join(" ");
  const centers = segmentCenters(
    resolved.map((entry) => entry.balance),
    total,
  );
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [laneWidth, setLaneWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = laneRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setLaneWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const placements =
    laneWidth === null
      ? []
      : fanLayout({
          centers: centers.map((center) => (center / 100) * laneWidth),
          laneWidth,
          diameter: AVATAR_DIAMETER,
          gap: AVATAR_GAP,
        });
  const rowCount =
    placements.length === 0
      ? 1
      : Math.max(...placements.map((placement) => placement.row)) + 1;

  return (
    <div
      className="min-w-0 flex-1"
      role="group"
      aria-label={isDebt ? "Dívidas" : "Créditos"}
    >
      <div
        ref={laneRef}
        className="relative"
        style={{
          height:
            rowCount * AVATAR_DIAMETER + (rowCount - 1) * AVATAR_GAP,
        }}
        aria-hidden="true"
      >
        {placements.map(({ index, x, row }) => (
          <span
            key={resolved[index].balance.participantId}
            className="absolute -translate-x-1/2"
            style={{
              left: x,
              bottom: row * (AVATAR_DIAMETER + AVATAR_GAP),
            }}
          >
            <PersonAvatar
              person={resolved[index].person}
              className={
                isDebt
                  ? "bg-destructive/10 text-destructive"
                  : "bg-success/10 text-success"
              }
            />
          </span>
        ))}
      </div>
      <div
        className={cn("grid h-2 gap-px overflow-hidden", edgeClass)}
        style={{ gridTemplateColumns }}
      >
        {resolved.map((entry) => (
          <div
            key={entry.balance.participantId}
            role="img"
            aria-label={`${balanceKind} de ${entry.person.name.split(" ")[0]}: ${signedAmountLabel(entry.balance.netCents)}`}
            className={accentClass}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5" aria-hidden="true">
        {resolved.map((entry) => (
          <span
            key={entry.balance.participantId}
            className={cn("font-mono text-[10px] font-medium tabular-nums whitespace-nowrap", toneClass)}
          >
            {entry.person.name.split(" ")[0]} {formatBRL(Math.abs(entry.balance.netCents)).slice(3)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ConsolidatedBalanceCard({
  balances,
  people,
  debtsCount,
  pixCount,
}: ConsolidatedBalanceCardProps) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const debtBalances = balances
    .filter((balance) => balance.netCents < 0)
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));
  const creditBalances = balances
    .filter((balance) => balance.netCents > 0)
    .sort((a, b) => Math.abs(a.netCents) - Math.abs(b.netCents));
  const debtTotal = debtBalances.reduce((total, balance) => total + balance.netCents, 0);
  const creditTotal = creditBalances.reduce((total, balance) => total + balance.netCents, 0);

  return (
    <section className="rounded-2xl border bg-card px-4 py-3" aria-label="Saldo consolidado">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">Saldo consolidado</p>
        <span className="font-mono text-xs text-muted-foreground">
          {debtsCount} dívidas → {pixCount} Pix
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span role="img" aria-label={`Dívida total: ${signedAmountLabel(debtTotal)}`}>
          <Money signed cents={debtTotal} className="text-lg font-semibold text-destructive" />
        </span>
        <span role="img" aria-label={`Crédito total: ${signedAmountLabel(creditTotal)}`}>
          <Money signed cents={creditTotal} className="text-lg font-semibold text-success" />
        </span>
      </div>
      <div className="mt-3 flex items-stretch">
        <ConsolidatedSide
          balances={debtBalances}
          peopleById={peopleById}
          totalCents={debtTotal}
          side="debt"
        />
        <div className="mx-2 w-px self-stretch bg-border" aria-hidden="true" />
        <ConsolidatedSide
          balances={creditBalances}
          peopleById={peopleById}
          totalCents={creditTotal}
          side="credit"
        />
      </div>
    </section>
  );
}
