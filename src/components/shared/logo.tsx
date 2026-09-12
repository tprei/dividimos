"use client";

import { useRef, useCallback } from "react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  animated?: boolean;
}

const sizes = {
  sm: { icon: 20, text: "text-lg" },
  md: { icon: 28, text: "text-2xl" },
  lg: { icon: 40, text: "text-4xl" },
};

export function Logo({ size = "md", showText = true, animated = false }: LogoProps) {
  const s = sizes[size];
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleTap = useCallback(() => {
    if (!animated || !ref.current) return;
    ref.current.classList.add("logo-split-active");
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      ref.current?.classList.remove("logo-split-active");
    }, 400);
  }, [animated]);

  return (
    <div
      ref={ref}
      className={`flex items-center gap-2.5 ${animated ? "logo-animated cursor-pointer" : ""}`}
      onClick={handleTap}
    >
      <svg
        width={s.icon + 8}
        height={s.icon + 8}
        viewBox="0 0 36 36"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="2" y="2" width="32" height="32" rx="9" className="fill-primary" />
        <circle cx="10" cy="18" r="3" fill="white" />
        <rect x="15.5" y="10" width="5" height="16" rx="2.5" fill="white" />
        <circle cx="26" cy="18" r="3" fill="white" />
      </svg>
      {showText && (
        <span className={`${s.text} font-bold tracking-tight`}>
          <span className={`inline-block ${animated ? "logo-split-left" : ""}`}>divid</span><span className={`inline-block ${animated ? "logo-split-right" : ""}`}>imos</span><span className="text-primary">.ai</span>
        </span>
      )}
    </div>
  );
}
