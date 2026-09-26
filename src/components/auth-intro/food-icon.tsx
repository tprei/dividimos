import type { ReactNode } from "react";
import type { IntroItemId } from "@/lib/intro-demo-bill";

const FRIES: readonly (readonly [number, number, number])[] = [
  [-5, -12, -12],
  [-1.5, -14, -3],
  [2, -13, 6],
  [5.5, -11, 14],
];

const CRUST_DOTS = [-6, -2, 2, 6];

const ICONS: Record<IntroItemId, ReactNode> = {
  chopp: (
    <>
      <path d="M-7,-5 L7,-5 L5.8,9 Q5.5,11 3.5,11 L-3.5,11 Q-5.5,11 -5.8,9 Z" fill="var(--food-gold)" />
      <path d="M-4,-1 L-3.3,8" stroke="#fff" strokeOpacity=".5" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M-8.5,-3 C-9.5,-9 -3.5,-11 -1,-8.5 C0.5,-12 6,-12 7,-8.5 C10,-9 10.5,-4.5 8.5,-3 Z"
        fill="var(--food-foam)"
      />
    </>
  ),
  batata: (
    <>
      {FRIES.map(([x, y, rotation]) => (
        <rect
          key={x}
          x={x}
          y={y}
          width="3"
          height="13"
          rx="1.4"
          fill="var(--food-gold)"
          transform={`rotate(${rotation} ${x + 1.5} ${y + 13})`}
        />
      ))}
      <path d="M-9,-3 H9 L7,10 Q6.6,12 4.6,12 H-4.6 Q-6.6,12 -7,10 Z" fill="var(--primary)" />
      <path d="M-5,1 H5" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  caipirinha: (
    <>
      <path
        d="M-8,-7 L8,-7 L6.4,9 Q6,11.5 3.6,11.5 H-3.6 Q-6,11.5 -6.4,9 Z"
        fill="var(--food-glass)"
        stroke="var(--food-lime-deep)"
        strokeOpacity=".55"
        strokeWidth="1.2"
      />
      <circle cx="-1.5" cy="3" r="3.2" fill="var(--food-lime)" />
      <circle cx="3" cy="6.5" r="2" fill="var(--food-lime-deep)" />
      <path d="M2,-7 a7,7 0 0 1 9,-5 l-2.5,5 Z" fill="var(--food-lime)" />
      <path d="M5,-14 L-1,6" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  pastel: (
    <>
      <path d="M-11,4 A11,11 0 0 1 11,4 Q11,8 7,8 H-7 Q-11,8 -11,4 Z" fill="var(--food-crust)" />
      <path
        d="M-10.4,4.5 Q-5,7 0,4.5 Q5,7 10.4,4.5"
        fill="none"
        stroke="var(--food-crust-deep)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {CRUST_DOTS.map((x) => (
        <circle key={x} cx={x} cy={Math.abs(x) < 3 ? -3 : -1} r="0.9" fill="var(--food-crust-deep)" />
      ))}
    </>
  ),
  guarana: (
    <>
      <rect x="-6.5" y="-11" width="13" height="22" rx="3" fill="var(--food-can)" />
      <rect x="-6.5" y="-3.5" width="13" height="7" fill="var(--food-can-band)" />
      <circle cx="0" cy="0" r="2.2" fill="var(--destructive)" />
      <rect x="-4.5" y="-12.5" width="9" height="2.5" rx="1.2" fill="var(--food-can-lid)" />
      <path d="M-4,-8 V-5 M-4,5 V8" stroke="#fff" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
};

interface FoodIconProps {
  item: IntroItemId;
  transform?: string;
}

/** The item's 24-unit icon, centered on the origin of its group. */
export function FoodIcon({ item, transform }: FoodIconProps) {
  return <g transform={transform}>{ICONS[item]}</g>;
}
