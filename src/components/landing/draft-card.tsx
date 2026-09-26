import { Sparkle } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { describeDemoSplit, type DemoExpenseDraft } from "@/lib/landing-expense-draft";
import { cn } from "@/lib/utils";
import styles from "./ways.module.css";

const VISIBLE_SEATS = 5;
const SEAT_TONES = [5, 0, 2, 7, 1, 4];

function Seats({ draft }: { draft: DemoExpenseDraft }) {
  const named = ["Eu", ...draft.names.map((name) => name.charAt(0).toLocaleUpperCase("pt-BR") + name.slice(1))];
  const shown = Math.min(draft.people, VISIBLE_SEATS);
  const seats = Array.from({ length: shown }, (_, index) => {
    const name = named.at(index);
    if (name) {
      return <UserAvatar key={index} name={name} size="sm" className="size-6.5 text-[11.5px]" />;
    }
    return (
      <span
        key={index}
        aria-hidden="true"
        className={styles.seat}
        style={{ background: `var(--avatar-tone-${SEAT_TONES[index % SEAT_TONES.length]})` }}
      />
    );
  });

  return (
    <span className={styles.avatars}>
      {seats}
      {draft.people > VISIBLE_SEATS && (
        <span aria-hidden="true" className={cn(styles.seat, styles.more)}>
          +{draft.people - VISIBLE_SEATS}
        </span>
      )}
    </span>
  );
}

export function DraftCard({ draft }: { draft: DemoExpenseDraft }) {
  return (
    <div className={styles.draft}>
      <div className={styles.draftTop}>
        <span className={styles.draftChip}>
          <Sparkle fill="currentColor" aria-hidden="true" />
          Rascunho
        </span>
        <span className={styles.draftTitle}>{draft.title}</span>
      </div>
      <p className={styles.draftAmount}>{formatBRL(draft.cents)}</p>
      <div className={styles.draftSplit}>
        <Seats draft={draft} />
        <span>{describeDemoSplit(draft)}</span>
      </div>
    </div>
  );
}
