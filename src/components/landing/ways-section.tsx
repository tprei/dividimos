import type { ReactNode } from "react";
import { MessageSquare, Mic, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChargeDemo } from "./charge-demo";
import { LandingSection, SectionHeading } from "./landing-section";
import { TextDemo } from "./text-demo";
import { VoiceDemo } from "./voice-demo";
import styles from "./ways.module.css";

interface WayCardProps {
  toneClass: string;
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}

function WayCard({ toneClass, icon, title, hint, children }: WayCardProps) {
  return (
    <article className={cn(styles.way, toneClass)}>
      <div className={styles.head}>
        <span className={styles.icon}>{icon}</span>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.hint}>{hint}</span>
      </div>
      <div className={styles.stage}>{children}</div>
    </article>
  );
}

export function WaysSection() {
  return (
    <LandingSection id="outros">
      <SectionHeading eyebrow="Outros jeitos de lançar" title="Escreve, fala ou cobra na hora." />
      <div className={styles.ways}>
        <WayCard
          toneClass={styles.text}
          icon={<MessageSquare aria-hidden="true" strokeWidth={2.2} />}
          title="Escreve do seu jeito"
          hint="Experimenta"
        >
          <TextDemo />
        </WayCard>
        <WayCard
          toneClass={styles.voice}
          icon={<Mic aria-hidden="true" strokeWidth={2.2} />}
          title="Fala que ele anota"
          hint="Toca no mic"
        >
          <VoiceDemo />
        </WayCard>
        <WayCard
          toneClass={styles.charge}
          icon={<Zap aria-hidden="true" strokeWidth={2.2} />}
          title="Cobrar rápido"
          hint="Aperta aí"
        >
          <ChargeDemo />
        </WayCard>
      </div>
    </LandingSection>
  );
}
