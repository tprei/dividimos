import { cn } from "@/lib/utils";
import parts from "./scenery.module.css";
import styles from "./sunday-beach.module.css";

const FRONDS = [
  "M-6 -10L12 -12Q29 10 35 48L21 -13L35 -14Q52 12 59 56L44 -14L58 -14Q75 14 81 62L68 -14L82 -14Q98 16 104 67L92 -13L106 -12Q120 18 126 70L116 -11L131 -9Q143 20 148 71L140 -8L155 -6Q166 22 170 70L165 -4L180 0Q190 25 192 67L190 2L205 6Q214 27 216 63L215 9L230 13Q238 30 239 57L240 17L255 22Q263 33 264 48L265 26L276 30L265 26L273 25Q270 16 255 22L240 17L254 14Q248 0 230 13L215 9L232 5Q226 -14 205 6L190 2L210 -4Q202 -25 180 0L165 -4L186 -11Q178 -34 155 -6L140 -8L161 -17Q153 -41 131 -9L116 -11L135 -21Q127 -46 106 -12L92 -13L109 -24Q101 -48 82 -14L68 -14L83 -25Q76 -47 58 -14L44 -14L56 -25Q50 -44 35 -14L21 -13L30 -23Q25 -39 12 -12Z",
  "M-6 -10L13 -7Q23 19 27 63L22 -5L35 -2Q44 27 47 78L44 0L58 3Q64 35 67 91L66 6L79 10Q84 43 86 103L88 14L101 19Q103 51 103 111L109 22L121 28Q121 59 121 118L129 32L141 39Q139 68 138 122L149 44L160 51Q157 76 155 124L168 56L179 65Q175 86 173 125L186 70L196 80Q194 96 192 125L203 86L213 96Q214 107 212 123L219 103L226 110L219 103L232 105Q227 95 213 96L203 86L225 90Q217 72 196 80L186 70L215 75Q205 50 179 65L168 56L201 60Q189 31 160 51L149 44L185 46Q172 14 141 39L129 32L166 32Q153 0 121 28L109 22L144 20Q131 -12 101 19L88 14L121 10Q109 -22 79 10L66 6L96 1Q84 -28 58 3L44 0L69 -7Q59 -32 35 -2L22 -5L41 -12Q33 -34 13 -7Z",
  "M-6 -10L8 -1Q4 21 2 64L14 4L26 13Q19 37 15 86L32 18L42 28Q32 53 27 105L48 33L58 44Q45 68 39 122L64 50L73 62Q57 84 50 136L78 68L87 80Q70 100 62 148L91 87L99 100Q82 117 74 159L103 108L109 122Q94 136 87 169L113 129L118 144Q107 155 101 179L121 152L126 168Q120 177 116 189L128 177L130 186L128 177L141 183Q137 173 126 168L121 152L146 164Q138 145 118 144L113 129L146 144Q135 118 109 122L103 108L142 123Q130 93 99 100L91 87L135 103Q121 68 87 80L78 68L123 82Q108 46 73 62L64 50L108 62Q93 26 58 44L48 33L90 42Q76 8 42 28L32 18L68 24Q56 -6 26 13L14 4L44 7Q34 -18 8 -1Z",
  "M-6 -10L0 2Q-14 15 -20 48L3 8L9 21Q-9 34 -17 71L12 27L17 41Q-5 53 -15 92L19 48L23 63Q-1 73 -12 111L25 70L28 85Q3 94 -8 128L29 93L31 109Q7 116 -3 146L31 117L32 134Q12 140 3 163L32 142L32 160Q16 166 9 182L32 168L30 187Q21 194 17 202L29 196L28 206L29 196L40 205Q37 196 30 187L32 168L53 185Q47 167 32 160L32 142L62 163Q53 139 32 134L31 117L67 140Q56 112 31 109L29 93L69 117Q56 86 28 85L25 70L66 93Q53 61 23 63L19 48L60 69Q47 37 17 41L12 27L50 45Q38 16 9 21L3 8L35 21Q25 -4 0 2Z",
];

const SPINES = "M-6 -10C80 -22 178 -10 276 30M-6 -10C84 2 166 40 226 110M-6 -10C60 32 112 98 130 186M-6 -10C26 46 40 116 28 206";

export function Palm({ className }: { className: string }) {
  return (
    <div className={cn(className, styles.palm)}>
      <svg viewBox="0 0 300 240">
        <path d={FRONDS[3]} style={{ fill: "var(--palm-dark)" }} />
        <path d={FRONDS[0]} style={{ fill: "var(--palm-dark)" }} />
        <path d={FRONDS[2]} style={{ fill: "var(--palm)" }} />
        <path d={FRONDS[1]} style={{ fill: "var(--palm)" }} />
        <path d={SPINES} style={{ fill: "none", stroke: "var(--palm-spine)", strokeWidth: 2.5 }} />
        <g style={{ fill: "var(--coconut)" }}>
          <circle cx="10" cy="8" r="11" />
          <circle cx="26" cy="2" r="10" />
          <circle cx="2" cy="22" r="9" />
        </g>
      </svg>
    </div>
  );
}

export function Kite({ className, tether }: { className: string; tether: "short" | "long" }) {
  return (
    <div className={cn(parts.spot, className, styles.kite)}>
      <svg viewBox="0 0 80 160">
        <path
          d={tether === "short" ? "M40 38C14 80-24 128-80 214" : "M40 38C10 100-60 260-420 760"}
          style={{ fill: "none", stroke: "var(--kite-line)", strokeWidth: 0.9 }}
        />
        <path d="M40 2 6 38h34zM74 38 40 96V38z" style={{ fill: "var(--kite-a)" }} />
        <path d="M40 2l34 36H40zM6 38l34 58V38z" style={{ fill: "var(--kite-b)" }} />
        <circle cx="40" cy="38" r="7" style={{ fill: "var(--kite-c)" }} />
        <path
          d="M40 2v94M6 38h68M40 96c8 10-8 18 0 28s-8 18 0 28"
          style={{ fill: "none", stroke: "var(--kite-line)", strokeWidth: 1.1 }}
        />
        <path d="M33 106l7 4-7 4zm14 0-7 4 7 4zM33 134l7 4-7 4zm14 0-7 4 7 4z" style={{ fill: "var(--kite-c)" }} />
        <path d="M33 120l7 4-7 4zm14 0-7 4 7 4z" style={{ fill: "var(--kite-b)" }} />
      </svg>
    </div>
  );
}

export function Umbrella({ className }: { className: string }) {
  return (
    <div className={cn(className, styles.umbrella)}>
      <svg viewBox="0 0 170 172">
        <defs>
          <clipPath id="sd-canopy">
            <path d="M8 62C14 30 46 8 85 8s71 22 77 54q-12.8 8-25.7 0q-12.8 8-25.7 0q-12.8 8-25.6 0q-12.8 8-25.7 0q-12.8 8-25.6 0q-12.8 8-25.7 0z" />
          </clipPath>
        </defs>
        <ellipse cx="96" cy="166" rx="44" ry="5" style={{ fill: "var(--umbrella-shade)" }} />
        <path d="M86 14l10 152" style={{ stroke: "var(--umbrella-pole)", strokeWidth: 4, strokeLinecap: "round" }} />
        <g clipPath="url(#sd-canopy)">
          <rect x="0" y="0" width="170" height="80" style={{ fill: "var(--umbrella-b)" }} />
          <path d="M85 8-18 80h35zM85 8 51 80h34zm0 0 34 72h34z" style={{ fill: "var(--umbrella-a)" }} />
        </g>
        <circle cx="85" cy="7" r="4" style={{ fill: "var(--umbrella-a)" }} />
      </svg>
    </div>
  );
}
