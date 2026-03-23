"use client";

import { Receipt } from "lucide-react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const sizes = {
  sm: { icon: 20, text: "text-lg" },
  md: { icon: 28, text: "text-2xl" },
  lg: { icon: 40, text: "text-4xl" },
};

export function Logo({ size = "md", showText = true }: LogoProps) {
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div className="gradient-primary rounded-xl p-2 shadow-md shadow-primary/20">
        <Receipt size={s.icon} className="text-white" strokeWidth={2.5} />
      </div>
      {showText && (
        <span className={`${s.text} font-bold tracking-tight`}>
          Pix<span className="text-primary">wise</span>
        </span>
      )}
    </div>
  );
}
