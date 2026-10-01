import { cn } from "@/lib/utils";
import { NightBar } from "./night-bar";
import { SceneryDefs } from "./scenery-parts";
import { SceneryFrame } from "./scenery-frame";
import { SundayBeach } from "./sunday-beach";
import styles from "./scenery.module.css";

export type SceneryVariant = "hero" | "auth" | "onboard";

interface SceneryProps {
  variant: SceneryVariant;
  className?: string;
}

export function Scenery({ variant, className }: SceneryProps) {
  return (
    <SceneryFrame className={cn(styles.frame, styles[variant], className)}>
      <SceneryDefs />
      <NightBar variant={variant} />
      <SundayBeach variant={variant} />
    </SceneryFrame>
  );
}
