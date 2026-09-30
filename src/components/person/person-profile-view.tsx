"use client";

import { motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ArrowLeft, Bot, Check, Loader2, MessageSquare } from "lucide-react";
import type { JSX } from "react";
import { usePullProgress } from "@/components/shared/pull-reveal";
import { UserBlockAction } from "@/components/profile/user-block-action";
import { ReportContentAction } from "@/components/reports/report-content-action";
import { AmountHeroCard } from "@/components/shared/amount-hero-card";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { Skeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { springs } from "@/lib/animations";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { firstNameOf, initialsOf } from "@/lib/people";
import type { GroupSnapshot, SharedSpending, UserProfile } from "@/types/ledger";

export type SharedSpendingView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; spending: SharedSpending };

export interface PersonProfileViewProps {
  person: UserProfile;
  meId: string;
  blocked: boolean;
  balance: { netCents: number; rows: DebtRow[] };
  sharedGroups: GroupSnapshot[];
  spending: SharedSpendingView;
  onRetrySpending: () => void;
  onBack: () => void;
  onMessage: () => void;
  messagePending: boolean;
  heroLayoutId?: string;
}

export const personHeroLayoutId = (userId: string) => `person-hero-${userId}`;

const chromeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.16, delay: 0.1 } },
};

const bandVariants = {
  hidden: { opacity: 0, scaleY: 0.72 },
  visible: { opacity: 1, scaleY: 1, transition: springs.reveal },
};

const bandReducedVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

const bodyVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { ...springs.reveal, delay: 0.06 } },
};

const bodyReducedVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

function PersonHero({
  person,
  displayName,
  onBack,
  layoutId,
}: {
  person: UserProfile;
  displayName: string;
  onBack: () => void;
  layoutId: string | undefined;
}) {
  const reduced = useReducedMotion() ?? false;
  const pull = usePullProgress();
  const resting = useMotionValue(0);
  const progress = pull ?? resting;
  const pullActive = pull !== null && !reduced;
  const stretch = useTransform(progress, (value) => 1 + Math.min(value, 1.2) * 0.06);
  const dim = useTransform(progress, (value) => Math.min(value, 1.2) * 0.08);

  return (
    <motion.section
      data-slot="person-hero"
      variants={reduced ? bandReducedVariants : bandVariants}
      style={{ transformOrigin: "50% 0%" }}
      className="relative isolate h-56 w-full overflow-hidden rounded-b-3xl bg-primary/10 md:rounded-3xl"
    >
      <motion.div
        aria-hidden="true"
        style={pullActive ? { scaleY: stretch, transformOrigin: "50% 0%" } : undefined}
        className="absolute inset-0 -z-10"
      >
        <div className="gradient-mesh absolute inset-0" />
        <span className="pointer-events-none absolute -top-6 right-10 rotate-[-8deg] text-[9rem] leading-none font-black tracking-tighter text-primary-text opacity-10 select-none">
          {initialsOf(displayName)}
        </span>
      </motion.div>
      {pullActive && (
        <motion.div aria-hidden="true" style={{ opacity: dim }} className="absolute inset-0 bg-foreground" />
      )}
      {pull !== null && (
        <div aria-hidden="true" className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
          <span className="block h-1 w-9 rounded-full bg-foreground/20" />
        </div>
      )}
      <motion.div variants={chromeVariants}>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Voltar"
          className="absolute top-3 left-3 z-10 size-11 rounded-full border border-border bg-card/80 text-foreground backdrop-blur-sm hover:bg-card"
          onClick={onBack}
        >
          <ArrowLeft className="size-5" />
        </Button>
      </motion.div>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 px-4 pb-4">
        <motion.div
          layoutId={reduced ? undefined : layoutId}
          transition={springs.reveal}
          style={{ borderRadius: "50%" }}
          className="shrink-0"
        >
          <UserAvatar
            id={person.id}
            name={displayName}
            avatarUrl={person.avatarUrl}
            isBot={person.isBot}
            size="lg"
            priority
            className="size-20 text-2xl ring-4 ring-background"
          />
        </motion.div>
        <motion.div variants={chromeVariants} className="min-w-0 flex-1 pb-1">
          <h1 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight break-words">{displayName}</h1>
          <p title={`@${person.handle}`} className="mt-0.5 truncate text-sm text-foreground/75">
            @{person.handle}
          </p>
          {person.isBot && (
            <Chip tone="primary" className="mt-2">
              <Bot />
              Bot verificado
            </Chip>
          )}
        </motion.div>
      </div>
    </motion.section>
  );
}

function BalanceSection({
  firstName,
  balance,
  sharedGroups,
}: {
  firstName: string;
  balance: PersonProfileViewProps["balance"];
  sharedGroups: GroupSnapshot[];
}) {
  const { netCents, rows } = balance;
  return (
    <section aria-label="Saldo" className="space-y-2">
      {netCents === 0 ? (
        <SectionCard className="flex min-h-14 items-center gap-3 px-4 py-3">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success-text">
            <Check className="size-4" strokeWidth={2.5} />
          </span>
          <p className="text-base font-semibold">Vocês estão quites</p>
        </SectionCard>
      ) : (
        <AmountHeroCard
          label={netCents > 0 ? `${firstName} te deve` : `Você deve pra ${firstName}`}
          cents={Math.abs(netCents)}
          tone={netCents > 0 ? "positive" : "negative"}
        />
      )}
      {rows.length > 0 && (
        <SectionCard>
          {rows.map((row) => {
            const subtitle = row.direction === "owed" ? `${firstName} te deve` : "Você deve";
            const trailing = (
              <Money cents={row.amountCents} size="sm" tone={row.direction === "owed" ? "positive" : "negative"} />
            );
            const key = `${row.groupId}:${row.direction}`;
            if (row.isDm) {
              return (
                <ListRow
                  key={key}
                  title="Conversa direta"
                  subtitle={subtitle}
                  trailingAlign="center"
                  leading={
                    <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <MessageSquare className="size-4" />
                    </span>
                  }
                  trailing={trailing}
                />
              );
            }
            return (
              <ListRow
                key={key}
                href={`/app/groups/${row.groupId}`}
                title={row.groupName}
                subtitle={subtitle}
                trailingAlign="center"
                leading={
                  <GroupAvatar
                    name={row.groupName}
                    groupId={row.groupId}
                    avatar={sharedGroups.find((snapshot) => snapshot.group.id === row.groupId)?.overview?.avatar}
                    size="sm"
                  />
                }
                trailing={trailing}
              />
            );
          })}
        </SectionCard>
      )}
    </section>
  );
}

function SpendingSection({
  firstName,
  spending,
  onRetry,
}: {
  firstName: string;
  spending: SharedSpendingView;
  onRetry: () => void;
}) {
  const heading = <h2 className="text-sm font-semibold text-muted-foreground">Gastos juntos</h2>;

  if (spending.status === "loading") {
    return (
      <SectionCard aria-busy="true" className="p-4">
        {heading}
        <div role="status" aria-label="Carregando gastos" className="mt-2">
          <div className="flex h-8 items-center"><Skeleton className="h-6 w-32" /></div>
          <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-24" /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
            {[0, 1].map((cell) => (
              <div key={cell}>
                <div className="flex h-4 items-center"><Skeleton className="h-3 w-16" /></div>
                <div className="flex h-5 items-center"><Skeleton className="h-4 w-20" /></div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    );
  }

  if (spending.status === "error") {
    return (
      <SectionCard className="p-4">
        {heading}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p role="alert" className="min-w-0 text-sm text-muted-foreground">{spending.message}</p>
          <Button variant="ghost" className="min-h-11 shrink-0" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </SectionCard>
    );
  }

  const { expenseCount, totalCents, myShareCents, theirShareCents } = spending.spending;

  if (expenseCount === 0) {
    return (
      <SectionCard className="p-4">
        {heading}
        <p className="mt-1 text-sm text-muted-foreground">Vocês ainda não dividiram nenhuma despesa.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard className="p-4">
      {heading}
      <Money cents={totalCents} size="lg" className="mt-2 block leading-8" />
      <p className="text-sm text-muted-foreground tabular-nums">
        em {expenseCount} {expenseCount === 1 ? "despesa" : "despesas"}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Sua parte</dt>
          <dd><Money cents={myShareCents} size="sm" /></dd>
        </div>
        <div className="min-w-0">
          <dt title={`Parte de ${firstName}`} className="truncate text-xs text-muted-foreground">Parte de {firstName}</dt>
          <dd><Money cents={theirShareCents} size="sm" /></dd>
        </div>
      </dl>
    </SectionCard>
  );
}

function CommonGroupsSection({ groups }: { groups: GroupSnapshot[] }) {
  return (
    <section aria-label="Grupos em comum">
      <SectionHeading title="Grupos em comum" count={groups.length} />
      <SectionCard>
        {groups.map((snapshot) => {
          const people = snapshot.members.filter((member) => member.status === "accepted").length + snapshot.guests.length;
          return (
            <ListRow
              key={snapshot.group.id}
              href={`/app/groups/${snapshot.group.id}`}
              title={snapshot.group.name}
              subtitle={`${people} ${people === 1 ? "pessoa" : "pessoas"}`}
              leading={
                <GroupAvatar
                  name={snapshot.group.name}
                  avatar={snapshot.overview?.avatar}
                  groupId={snapshot.group.id}
                  size="sm"
                />
              }
            />
          );
        })}
      </SectionCard>
    </section>
  );
}

/**
 * Another person's face inside the app: who they are, where the money stands
 * between you, what you've split so far, and the groups you share. Reveals
 * through the `hidden`/`visible` variants of the view layer that hosts it.
 */
export function PersonProfileView({
  person,
  meId,
  blocked,
  balance,
  sharedGroups,
  spending,
  onRetrySpending,
  onBack,
  onMessage,
  messagePending,
  heroLayoutId,
}: PersonProfileViewProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const displayName = person.name.trim() || `@${person.handle}`;
  const firstName = firstNameOf(person.name) || `@${person.handle}`;

  return (
    <div className="mx-auto max-w-lg pb-6 md:max-w-2xl md:px-4 md:pt-4">
      <PersonHero person={person} displayName={displayName} onBack={onBack} layoutId={heroLayoutId} />

      <motion.div variants={reduced ? bodyReducedVariants : bodyVariants} className="px-4 md:px-0">
        {!blocked && (
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={messagePending}
            aria-busy={messagePending || undefined}
            onClick={() => {
              haptics.tap();
              onMessage();
            }}
          >
            {messagePending ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare className="size-4" aria-hidden="true" />
            )}
            Mandar mensagem
          </Button>
        )}

        <div className="mt-6 space-y-6">
          <BalanceSection firstName={firstName} balance={balance} sharedGroups={sharedGroups} />
          <SpendingSection firstName={firstName} spending={spending} onRetry={onRetrySpending} />
          {sharedGroups.length > 0 && <CommonGroupsSection groups={sharedGroups} />}
          <div className="space-y-2">
            <ReportContentAction
              key={`${meId}:${person.id}`}
              subject={person}
              messageId={null}
              messagePreview={null}
              presentation="profile"
            />
            <UserBlockAction key={`${meId}:${person.id}:block`} target={person} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
