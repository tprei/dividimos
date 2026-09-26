"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Zap } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { pointOf, useClickFx, useRipple } from "./click-fx";
import styles from "./charge-demo.module.css";

const AMOUNTS = [
  { cents: 2000, label: "R$ 20" },
  { cents: 4500, label: "R$ 45" },
  { cents: 10000, label: "R$ 100" },
];
const INITIAL_CENTS = 4500;
const INITIAL_SEED = 20260925;
const QR_SIZE = 25;
const FINDER_SIZE = 7;

function nextSeed(seed: number): number {
  return (Math.imul(seed, 48271) + 11) >>> 0;
}

function fakeQrPath(seed: number): string {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const grid = Array.from({ length: QR_SIZE }, () => Array.from({ length: QR_SIZE }, () => random() < 0.47));

  const drawFinder = (originX: number, originY: number) => {
    for (let y = -1; y <= FINDER_SIZE; y++) {
      for (let x = -1; x <= FINDER_SIZE; x++) {
        const column = originX + x;
        const row = originY + y;
        if (column < 0 || row < 0 || column >= QR_SIZE || row >= QR_SIZE) continue;
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        grid[row][column] = ring === 3 || ring <= 1;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(QR_SIZE - FINDER_SIZE, 0);
  drawFinder(0, QR_SIZE - FINDER_SIZE);
  for (let i = FINDER_SIZE + 1; i < QR_SIZE - FINDER_SIZE - 1; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  let path = "";
  grid.forEach((cells, y) =>
    cells.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return path;
}

interface AmountChipProps {
  label: string;
  pressed: boolean;
  onPick: (button: HTMLButtonElement) => void;
}

function AmountChip({ label, pressed, onPick }: AmountChipProps) {
  const { onPointerDown, ripples } = useRipple(pressed ? styles.rippleLight : styles.rippleTint);
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={pressed}
      onPointerDown={onPointerDown}
      onClick={(event) => onPick(event.currentTarget)}
    >
      {label}
      {ripples}
    </button>
  );
}

export function ChargeDemo() {
  const fx = useClickFx();
  const { onPointerDown, ripples } = useRipple();
  const [cents, setCents] = useState(INITIAL_CENTS);
  const [count, setCount] = useState(0);
  const [seed, setSeed] = useState(() => nextSeed(INITIAL_SEED));
  const qrPath = useMemo(() => fakeQrPath(seed), [seed]);

  const pick = (amount: number, button: HTMLButtonElement) => {
    setCents(amount);
    setSeed(nextSeed);
    fx.squish(button);
  };

  const generate = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const point = pointOf(event, button);
    setCount((current) => current + 1);
    setSeed(nextSeed);
    fx.squish(button);
    fx.burst(point, "pix", 16 + Math.min(fx.combo(button), 6) * 2);
    fx.floatText(point, `Cobrança de ${formatBRL(cents)}`, "pix");
  };

  return (
    <>
      <div className={styles.amounts} role="group" aria-label="Valor da cobrança">
        {AMOUNTS.map((amount) => (
          <AmountChip
            key={amount.cents}
            label={amount.label}
            pressed={amount.cents === cents}
            onPick={(button) => pick(amount.cents, button)}
          />
        ))}
      </div>
      <div key={count} className={cn(styles.card, count > 0 && styles.popped)}>
        <div className={styles.qr}>
          <svg viewBox="-1 -1 27 27" aria-hidden="true">
            <path fill="currentColor" d={qrPath} />
          </svg>
        </div>
        <div>
          <p className={styles.label}>Cobrança Pix</p>
          <p className={styles.value} aria-live="polite">
            {formatBRL(cents)}
          </p>
          <p className={styles.status}>
            <i aria-hidden="true" />
            Aguardando pagamento
          </p>
        </div>
      </div>
      <button type="button" className={styles.generate} onPointerDown={onPointerDown} onClick={generate}>
        <Zap fill="currentColor" aria-hidden="true" />
        Gerar cobrança Pix
        {count > 0 && (
          <span key={count} className={styles.badge}>
            ×{count}
          </span>
        )}
        {ripples}
      </button>
    </>
  );
}
