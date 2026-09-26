import { InstallPrompt } from "@/components/pwa/install-prompt";
import { cn } from "@/lib/utils";
import { HeroScene } from "./hero-scene";
import { LandingLink } from "./landing-link";
import { landingContainer } from "./landing-section";
import styles from "./hero.module.css";

export function Hero() {
  return (
    <section id="top" className={styles.hero}>
      <div className={cn(landingContainer, styles.grid)}>
        <div className={styles.copy}>
          <h1 className={styles.title}>
            Quem divide, <span className={styles.accent}>multiplica</span>.
          </h1>
          <p className={styles.sub}>
            Saiu pro rolê com os amigos, mas ficou só na água? Enquanto todo mundo ficou no
            litrão? Não se preocupa! Vamos deixar justo pra você.
          </p>
          <div className={styles.cta}>
            <LandingLink href="/app" size="lg">
              Bora rachar
            </LandingLink>
            <InstallPrompt />
          </div>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}
