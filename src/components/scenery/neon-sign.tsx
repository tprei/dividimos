import { cn } from "@/lib/utils";
import parts from "./scenery.module.css";
import styles from "./night-bar.module.css";

const WORD =
  "M33 44C31 37 24 35 19 38 12 42 12 55 19 58 25 61 31 56 33 50M33 38V66C33 77 26 82 18 80 13 79 11 76 11 74M44 50H62C62 41 56 36 51 37 44 38 41 45 42 51 43 58 49 61 55 60 59 59 61 57 62 55M72 14V54C72 59 75 61 78 60M102 44C100 38 94 36 89 38 83 41 81 50 84 56 87 61 95 61 99 56 101 53 102 49 102 44M102 38V56C102 59 104 61 107 60M134 44C132 38 126 36 121 38 115 41 113 50 116 56 119 61 127 61 131 56 133 53 134 49 134 44M134 14V56C134 59 136 61 139 60M166 44C164 38 158 36 153 38 147 41 145 50 148 56 151 61 159 61 163 56 165 53 166 49 166 44M166 38V56C166 59 168 61 171 60";

const SWOSH = "M46 76C86 68 132 68 172 75";

export function NeonSign({ className }: { className: string }) {
  return (
    <div className={cn(parts.spot, className, styles.neon)}>
      <div className={styles.neonTube}>
        <svg viewBox="0 0 182 92">
          <defs>
            <path id="sn-word" d={WORD} />
            <path id="sn-swosh" d={SWOSH} />
          </defs>
          <g className={styles.neonWide}>
            <use href="#sn-word" />
            <use href="#sn-swosh" className={styles.neonPink} />
          </g>
          <g className={styles.neonMid}>
            <use href="#sn-word" />
            <use href="#sn-swosh" className={styles.neonPink} />
          </g>
          <g className={styles.neonCore}>
            <use href="#sn-word" />
            <use href="#sn-swosh" className={styles.neonPinkCore} />
          </g>
        </svg>
      </div>
    </div>
  );
}
