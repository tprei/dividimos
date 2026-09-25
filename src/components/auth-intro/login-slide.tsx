"use client";

import { useState } from "react";
import { AuthPanel } from "@/app/auth/auth-panel";
import { cn } from "@/lib/utils";
import { LoginBrand } from "./login-brand";
import type { IntroSceneStage } from "./scene-stage";

interface LoginSlideProps {
  stage: IntroSceneStage;
}

export function LoginSlide({ stage }: LoginSlideProps) {
  const [intro] = useState(() => stage === "play");

  return (
    <div className="flex h-full w-full flex-col items-center justify-center-safe overflow-y-auto overscroll-none px-5.5 pt-3 pb-2 touch-pan-y touch-pinch-zoom intro-landscape:flex-row intro-landscape:flex-wrap intro-landscape:content-center-safe intro-landscape:justify-center intro-landscape:gap-x-7">
      <LoginBrand stage={stage} />
      <AuthPanel className={cn(intro && "intro-enter-up [animation-delay:90ms]")} />
    </div>
  );
}
