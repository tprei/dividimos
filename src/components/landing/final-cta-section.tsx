import { LandingLink } from "./landing-link";
import { LandingSection } from "./landing-section";
import { BottleCap } from "./table-art";
import styles from "./final-cta-section.module.css";

export function FinalCtaSection() {
  return (
    <LandingSection className="pb-[clamp(64px,9vw,112px)]">
      <div className={styles.stage}>
        <div className={styles.table} aria-hidden="true" />
        <BottleCap tone="silver" className={styles.cap1} />
        <BottleCap tone="amber" className={styles.cap2} />
        <div className={styles.paper}>
          <div className={styles.sheet}>
            <h2 className={styles.title}>Bora rachar?</h2>
            <LandingLink href="/app" size="lg">
              Rachar uma conta
            </LandingLink>
          </div>
        </div>
      </div>
    </LandingSection>
  );
}
