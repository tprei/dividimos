import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const landingContainer = "mx-auto w-[min(1128px,calc(100%-40px))]";

interface LandingSectionProps {
  id?: string;
  className?: string;
  children: ReactNode;
}

export function LandingSection({ id, className, children }: LandingSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-18 pt-[clamp(64px,9vw,112px)]", className)}>
      <div className={landingContainer}>{children}</div>
    </section>
  );
}

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  lede?: string;
  className?: string;
}

export function SectionHeading({ eyebrow, title, lede, className }: SectionHeadingProps) {
  return (
    <div className={cn("mb-[clamp(28px,4vw,44px)] max-w-[660px]", className)}>
      <p className="inline-flex items-center gap-2.5 text-xs font-black tracking-[0.14em] text-primary-text uppercase before:w-6.5 before:border-t-2 before:border-dashed before:border-primary-text/45 before:content-['']">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-[clamp(27px,6vw,40px)] leading-[1.1] font-black tracking-[-0.025em] text-balance">
        {title}
      </h2>
      {lede && <p className="mt-3 text-[17px] text-muted-foreground">{lede}</p>}
    </div>
  );
}
