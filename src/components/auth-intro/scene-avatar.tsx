import type { IntroPerson } from "@/lib/intro-demo-bill";

interface SceneAvatarProps {
  person: IntroPerson;
  cx: number;
  cy: number;
  r: number;
}

/** A demo person drawn inside a scene SVG: a light "object" circle that keeps its tone in dark mode. */
export function SceneAvatar({ person, cx, cy, r }: SceneAvatarProps) {
  const tone = `var(--obj-avatar-tone-${person.avatarTone})`;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={tone}
        stroke={`color-mix(in oklab, ${tone} 75%, var(--obj-ink))`}
        strokeOpacity=".35"
      />
      <text
        x={cx}
        y={cy + r * 0.33}
        textAnchor="middle"
        fontSize={r * 0.82}
        fontWeight="900"
        fill="var(--obj-avatar-fg)"
      >
        {person.initials}
      </text>
    </g>
  );
}

export function avatarRingColor(person: IntroPerson): string {
  return `color-mix(in oklab, var(--obj-avatar-tone-${person.avatarTone}) 58%, var(--obj-ink))`;
}
