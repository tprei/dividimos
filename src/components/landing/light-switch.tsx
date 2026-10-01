"use client";

import { useRef } from "react";
import { haptics } from "@/hooks/use-haptics";
import { switchLights, useLightsOn } from "./lights";
import styles from "./light-switch.module.css";

export function LightSwitch() {
  const lightsOn = useLightsOn();
  const iconRef = useRef<SVGSVGElement>(null);

  const flip = () => {
    haptics.tap();
    if (iconRef.current) switchLights(iconRef.current);
  };

  return (
    <button type="button" className={styles.switch} aria-label="Luz do bar" aria-pressed={lightsOn ?? undefined} onClick={flip}>
      <svg ref={iconRef} className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path className={styles.rays} d="M12 1.5v1.6M4.2 4.7l1.1 1.1M19.8 4.7l-1.1 1.1M1.8 11.5h1.6M20.6 11.5h1.6" />
        <path
          className={styles.glass}
          d="M12 5a6 6 0 0 0-3.7 10.7c.6.5 1 1.2 1 2v.3h5.4v-.3c0-.8.4-1.5 1-2A6 6 0 0 0 12 5Z"
        />
        <path className={styles.base} d="M9.6 20.2h4.8M10.4 22.4h3.2" />
      </svg>
    </button>
  );
}
