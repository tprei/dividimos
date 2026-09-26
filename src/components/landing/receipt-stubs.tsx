"use client";

import { useRef, useState, type MouseEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { Zap } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { pointOf, useClickFx, useRipple } from "./click-fx";
import { ANA, BRUNO, CARLA, DIEGO, type SamplePerson } from "./sample-people";
import styles from "./hero-receipt.module.css";

interface Payer {
  person: SamplePerson;
  cents: number;
}

const PAYERS: Payer[] = [
  { person: BRUNO, cents: 8434 },
  { person: CARLA, cents: 3685 },
  { person: DIEGO, cents: 7013 },
];

const ANA_RECEIVES_CENTS = 19132;

function StubTop({ person }: { person: SamplePerson }) {
  return (
    <div className={styles.stubTop}>
      <UserAvatar name={person.name} size="sm" className="size-6.5 text-[11.5px]" />
      <span className={styles.stubName}>{person.firstName}</span>
    </div>
  );
}

function PayerStub({ payer, onPaid }: { payer: Payer; onPaid: (payer: Payer) => void }) {
  const fx = useClickFx();
  const { onPointerDown, ripples } = useRipple();
  const amount = formatBRL(payer.cents);

  const pay = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const count = fx.combo(button);
    const point = pointOf(event, button);
    fx.squish(button);
    fx.burst(point, "pix", 12 + Math.min(count, 6) * 2);
    fx.floatText(point, count > 1 ? `${amount} ✓ ×${count}` : `${amount} ✓`, "pix");
    onPaid(payer);
  };

  return (
    <div className={styles.stub}>
      <StubTop person={payer.person} />
      <p className={cn(styles.stubAmount, styles.money)}>{amount}</p>
      <button
        type="button"
        className={styles.stubButton}
        aria-label={`Pagar via Pix: ${payer.person.firstName}, ${amount}`}
        onPointerDown={onPointerDown}
        onClick={pay}
      >
        <Zap fill="currentColor" aria-hidden="true" />
        Pagar via Pix
        {ripples}
      </button>
    </div>
  );
}

export function ReceiptStubs() {
  const reduceMotion = useReducedMotion();
  const receives = useRef<HTMLParagraphElement>(null);
  const [announcement, setAnnouncement] = useState("");

  const celebrate = (payer: Payer) => {
    setAnnouncement(`${payer.person.firstName} pagou ${formatBRL(payer.cents)} via Pix`);
    if (reduceMotion) return;
    receives.current?.animate([{ scale: 1 }, { scale: 1.16 }, { scale: 1 }], {
      duration: 420,
      easing: "ease-out",
    });
  };

  return (
    <div className={styles.stubs}>
      <div className={styles.stub}>
        <StubTop person={ANA} />
        <p className={styles.stubTag}>Pagou a conta</p>
        <p ref={receives} className={cn(styles.receives, styles.money)}>
          recebe {formatBRL(ANA_RECEIVES_CENTS)}
        </p>
      </div>
      {PAYERS.map((payer) => (
        <PayerStub key={payer.person.name} payer={payer} onPaid={celebrate} />
      ))}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
