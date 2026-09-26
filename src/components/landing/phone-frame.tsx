import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import styles from "./phone-frame.module.css";

const SCREEN_WIDTH = 1170;
const SCREEN_HEIGHT = 2391;

interface PhoneFrameProps {
  src: string;
  alt: string;
  caption?: string;
  step?: number;
  className?: string;
}

function StatusGlyphs() {
  return (
    <svg viewBox="0 0 78 14" fill="currentColor" className={styles.glyphs}>
      <rect x="0" y="9" width="3" height="4" rx="1" />
      <rect x="4.5" y="6.5" width="3" height="6.5" rx="1" />
      <rect x="9" y="4" width="3" height="9" rx="1" />
      <rect x="13.5" y="1.5" width="3" height="11.5" rx="1" />
      <path d="M31 12.6a1.6 1.6 0 1 1 0 .01zM26.2 8.6a6.8 6.8 0 0 1 9.6 0l-1.3 1.3a5 5 0 0 0-7 0zM23.4 5.8a10.8 10.8 0 0 1 15.2 0l-1.3 1.3a9 9 0 0 0-12.6 0z" />
      <rect x="48" y="1.5" width="25" height="11" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
      <rect x="50" y="3.5" width="21" height="7" rx="1.8" />
      <path d="M74.6 5.3v3.4a1.9 1.9 0 0 0 0-3.4z" opacity=".45" />
    </svg>
  );
}

export function PhoneFrame({ src, alt, caption, step, className }: PhoneFrameProps) {
  return (
    <figure className={cn(styles.phone, className)}>
      <div className={styles.body}>
        <div className={styles.screen}>
          <div className={styles.status} aria-hidden="true">
            <span>9:41</span>
            <span className={styles.pill} />
            <StatusGlyphs />
          </div>
          <Image
            src={src}
            alt={alt}
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            sizes="(min-width: 900px) 290px, min(76vw, 300px)"
            className={styles.image}
          />
        </div>
      </div>
      {caption && (
        <figcaption className={styles.caption}>
          {step !== undefined && <span className={styles.step}>{step}</span>}
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function PhoneRow({ tilted = false, children }: { tilted?: boolean; children: ReactNode }) {
  return <div className={cn(styles.row, tilted && styles.tilted)}>{children}</div>;
}

export const soloPhoneClass = styles.solo;
