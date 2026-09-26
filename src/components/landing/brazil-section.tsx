import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LandingSection } from "./landing-section";
import styles from "./brazil-section.module.css";

const COMPARISON = [
  { topic: "Como paga", us: "Pix de qualquer banco, com QR e copia e cola", them: "transferência manual, na mão" },
  { topic: "Valores", us: "R$ e centavo exato", them: "dólar e arredondamento" },
  { topic: "Na conta", us: "10% do garçom e couvert na conta certa", them: "taxa genérica, se é que tem" },
  { topic: "Preço", us: "grátis, sem assinatura", them: "assinatura" },
];

function FlagArt() {
  return (
    <div className={styles.art} aria-hidden="true">
      <span className={styles.dots} />
      <svg className={styles.flag} viewBox="0 0 20 14">
        <defs>
          <radialGradient id="landing-globe" cx="38%" cy="32%" r="78%">
            <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--br-blue) 72%, white)" }} />
            <stop offset=".62" style={{ stopColor: "var(--br-blue)" }} />
            <stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--br-blue) 80%, black)" }} />
          </radialGradient>
          <clipPath id="landing-globe-clip">
            <circle cx="10" cy="7" r="3.5" />
          </clipPath>
        </defs>
        <path
          d="M1.7 7 L10 1.7 L18.3 7 L10 12.3 Z"
          fill="var(--br-yellow)"
          stroke="var(--br-yellow)"
          strokeWidth=".5"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="7" r="3.5" fill="url(#landing-globe)" />
        <circle
          cx="8"
          cy="14"
          r="8.25"
          fill="none"
          stroke="oklch(0.98 0.01 95)"
          strokeWidth=".5"
          clipPath="url(#landing-globe-clip)"
        />
      </svg>
    </div>
  );
}

export function BrazilSection() {
  return (
    <LandingSection>
      <div className={styles.card}>
        <FlagArt />
        <div className={styles.head}>
          <p className={styles.eyebrow}>Feito pro Brasil</p>
          <h2 className={styles.title}>Feito pra como a gente racha conta aqui.</h2>
        </div>
        <div className={styles.table}>
          <div className={styles.tableHead} aria-hidden="true">
            <div />
            <div className={styles.headUs}>Dividimos</div>
            <div className={styles.headThem}>Apps gringos</div>
          </div>
          {COMPARISON.map((row) => (
            <div key={row.topic} className={styles.row}>
              <p className={styles.topic}>{row.topic}</p>
              <p className={cn(styles.cell, styles.us)}>
                <Check aria-hidden="true" strokeWidth={3} />
                <span>
                  <span className="sr-only">Dividimos: </span>
                  {row.us}
                </span>
              </p>
              <p className={cn(styles.cell, styles.them)}>
                <X aria-hidden="true" strokeWidth={3} />
                <span>
                  <span className="sr-only">Apps gringos: </span>
                  {row.them}
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </LandingSection>
  );
}
