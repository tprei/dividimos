"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

export type FxTone = "pix" | "amber";

export interface FxPoint {
  x: number;
  y: number;
}

export interface ClickFx {
  burst: (point: FxPoint, tone: FxTone, count: number) => void;
  floatText: (point: FxPoint, text: string, tone: FxTone) => void;
  squish: (element: HTMLElement) => void;
  combo: (key: object) => number;
}

type FxItem =
  | {
      kind: "particle";
      id: number;
      point: FxPoint;
      color: string;
      size: number;
      dx: number;
      dy: number;
      rotate: number;
      duration: number;
    }
  | FxLabel;

interface FxLabel {
  kind: "text";
  id: number;
  point: FxPoint;
  text: string;
  tone: FxTone;
}

interface Ripple {
  id: number;
  left: number;
  top: number;
  size: number;
}

const PALETTES: Record<FxTone, readonly string[]> = {
  pix: [
    "var(--pix-from)",
    "var(--pix-to)",
    "color-mix(in oklab, var(--pix-from) 45%, white)",
    "var(--pix-foreground)",
  ],
  amber: [
    "var(--primary)",
    "var(--gradient-primary-end)",
    "color-mix(in oklab, var(--primary) 45%, white)",
    "var(--gradient-foreground)",
  ],
};

const COMBO_WINDOW_MS = 900;
const STILL_LABEL_MS = 1200;

const FxContext = createContext<ClickFx | null>(null);

export function pointOf(
  event: { clientX: number; clientY: number; detail: number },
  element: HTMLElement,
): FxPoint {
  if (event.detail !== 0) return { x: event.clientX, y: event.clientY };
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function particleStyle(item: Extract<FxItem, { kind: "particle" }>): CSSProperties {
  return {
    left: item.point.x,
    top: item.point.y,
    width: item.size,
    height: item.size,
    background: item.color,
    "--fx-dx": `${item.dx}px`,
    "--fx-dy": `${item.dy}px`,
    "--fx-rotate": `${item.rotate}deg`,
    "--fx-duration": `${item.duration}ms`,
  } as CSSProperties;
}

export function FxProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [items, setItems] = useState<FxItem[]>([]);
  const [stillLabel, setStillLabel] = useState<FxLabel | null>(null);
  const nextId = useRef(0);
  const combos = useRef(new WeakMap<object, { count: number; at: number }>());
  const stillTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => () => clearTimeout(stillTimer.current), []);

  const fx = useMemo<ClickFx>(
    () => ({
      burst(point, tone, count) {
        if (reduceMotion) return;
        const palette = PALETTES[tone];
        const particles: FxItem[] = Array.from({ length: count }, (_, index) => {
          const angle = Math.random() * Math.PI * 2;
          const distance = 36 + Math.random() * 70;
          return {
            kind: "particle",
            id: nextId.current++,
            point,
            color: palette[index % palette.length],
            size: 5 + Math.random() * 6,
            dx: Math.cos(angle) * distance,
            dy: Math.sin(angle) * distance + 14,
            rotate: 200 + Math.random() * 320,
            duration: 650 + Math.random() * 450,
          };
        });
        setItems((current) => [...current, ...particles]);
      },
      floatText(point, text, tone) {
        const item: FxLabel = { kind: "text", id: nextId.current++, point, text, tone };
        if (!reduceMotion) {
          setItems((current) => [...current, item]);
          return;
        }
        setStillLabel(item);
        clearTimeout(stillTimer.current);
        stillTimer.current = setTimeout(() => setStillLabel(null), STILL_LABEL_MS);
      },
      squish(element) {
        if (reduceMotion) return;
        element.animate([{ scale: 1 }, { scale: 0.92 }, { scale: 1.05 }, { scale: 1 }], {
          duration: 340,
          easing: "ease-out",
        });
      },
      combo(key) {
        const now = performance.now();
        const last = combos.current.get(key);
        const count = last && now - last.at < COMBO_WINDOW_MS ? last.count + 1 : 1;
        combos.current.set(key, { count, at: now });
        return count;
      },
    }),
    [reduceMotion],
  );

  return (
    <FxContext.Provider value={fx}>
      {children}
      <div className={styles.fxLayer} aria-hidden="true">
        {items.map((item) =>
          item.kind === "particle" ? (
            <i
              key={item.id}
              className={styles.fxParticle}
              style={particleStyle(item)}
              onAnimationEnd={() => remove(item.id)}
            />
          ) : (
            <span
              key={item.id}
              className={cn(styles.fxText, item.tone === "pix" ? styles.fxPix : styles.fxAmber)}
              style={{ left: item.point.x, top: item.point.y }}
              onAnimationEnd={() => remove(item.id)}
            >
              {item.text}
            </span>
          ),
        )}
        {stillLabel && (
          <span
            className={cn(styles.fxText, styles.fxStill, stillLabel.tone === "pix" ? styles.fxPix : styles.fxAmber)}
            style={{ left: stillLabel.point.x, top: stillLabel.point.y }}
          >
            {stillLabel.text}
          </span>
        )}
      </div>
    </FxContext.Provider>
  );
}

export function useClickFx(): ClickFx {
  const fx = useContext(FxContext);
  if (!fx) throw new Error("useClickFx must be used inside FxProvider");
  return fx;
}

export function useRipple(rippleClassName?: string): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  ripples: ReactNode;
} {
  const reduceMotion = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (reduceMotion) return;
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const scale = target.offsetWidth / rect.width;
      const size = Math.max(target.offsetWidth, target.offsetHeight) * 2.2;
      const ripple: Ripple = {
        id: nextId.current++,
        size,
        left: (event.clientX - rect.left) * scale - size / 2,
        top: (event.clientY - rect.top) * scale - size / 2,
      };
      setRipples((current) => [...current, ripple]);
    },
    [reduceMotion],
  );

  const nodes = ripples.map((ripple) => (
    <span
      key={ripple.id}
      aria-hidden="true"
      className={cn(styles.ripple, rippleClassName)}
      style={{ width: ripple.size, height: ripple.size, left: ripple.left, top: ripple.top }}
      onAnimationEnd={() => setRipples((current) => current.filter((r) => r.id !== ripple.id))}
    />
  ));

  return { onPointerDown, ripples: nodes };
}
