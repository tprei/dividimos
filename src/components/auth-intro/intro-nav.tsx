"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTRO_AUTO_ADVANCE_MS } from "./use-auto-advance";

interface IntroNavProps {
  index: number;
  titles: readonly string[];
  counting: boolean;
  cycle: number;
  showSkip: boolean;
  showCue: boolean;
  onGoTo: (index: number) => void;
  onStep: (direction: 1 | -1) => void;
}

const STORY_ARROW_CLASS =
  "hidden size-11 place-items-center rounded-full text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 lg:grid";

/** Below `lg`: dots for every slide, Próximo and Pular. From `lg` up: story dots between arrows. */
export function IntroNav({ index, titles, counting, cycle, showSkip, showCue, onGoTo, onStep }: IntroNavProps) {
  const lastIndex = titles.length - 1;
  const onLogin = index === lastIndex;
  const label = index === lastIndex - 1 ? "Bora começar" : "Próximo";
  const [shownLabel, setShownLabel] = useState(label);
  const [labelChanges, setLabelChanges] = useState(0);
  if (shownLabel !== label) {
    setShownLabel(label);
    setLabelChanges((changes) => changes + 1);
  }

  return (
    <nav
      aria-label="Navegação dos slides"
      onContextMenu={(event) => event.preventDefault()}
      className="relative flex flex-none flex-col gap-1.5 px-5.5 pt-0.5 pb-4 select-none intro-tiny:gap-0.5 intro-tiny:pb-2.5 intro-landscape:flex-row intro-landscape:items-center intro-landscape:justify-between intro-landscape:px-7 intro-landscape:pb-2 lg:px-14 lg:pt-1 lg:pb-7"
    >
      <div className="relative flex items-center justify-center gap-1">
        <button type="button" aria-label="Slide anterior" onClick={() => onStep(-1)} className={STORY_ARROW_CLASS}>
          <ChevronLeft className="size-5" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <div
          className="mx-auto flex justify-center intro-landscape:m-0 lg:mx-1.5"
          data-counting={counting ? "" : undefined}
        >
          {titles.map((title, dot) => (
            <button
              key={title}
              type="button"
              aria-label={`Ir pro slide ${dot + 1}: ${title}`}
              aria-current={dot === index}
              data-past={dot < index ? "" : undefined}
              onClick={() => onGoTo(dot)}
              className={cn(
                "intro-dot grid size-11 place-items-center rounded-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-12",
                dot === lastIndex && "lg:hidden",
              )}
            >
              <i>
                {dot === index && counting && (
                  <span
                    key={cycle}
                    className="intro-dot-fill"
                    style={{ animationDuration: `${INTRO_AUTO_ADVANCE_MS}ms` }}
                  />
                )}
              </i>
            </button>
          ))}
        </div>
        <button type="button" aria-label="Próximo slide" onClick={() => onStep(1)} className={STORY_ARROW_CLASS}>
          <ChevronRight className="size-5" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <div
          aria-hidden="true"
          data-off={showCue ? undefined : ""}
          className="intro-swipe-cue absolute top-1/2 -right-1.5 flex h-11 -translate-y-1/2 items-center gap-[3px] px-1.5 text-[12.5px] font-extrabold tracking-[0.02em] text-muted-foreground intro-landscape:hidden lg:hidden"
        >
          <span>arraste</span>
          <ChevronRight className="intro-cue-chevron size-3.5 text-primary-text" strokeWidth={3} />
        </div>
      </div>
      <div className="intro-nav-wrap intro-landscape:m-0 lg:hidden" data-collapsed={onLogin ? "" : undefined}>
        <div className="intro-nav-inner">
          <div className="flex flex-col items-stretch gap-0.5 px-2 pt-1.5 intro-landscape:flex-row-reverse intro-landscape:items-center intro-landscape:gap-2 intro-landscape:p-1.5">
            <Button
              onClick={() => onGoTo(index + 1)}
              tabIndex={onLogin ? -1 : undefined}
              className="h-13.5 rounded-full bg-cta text-[17px] font-extrabold text-cta-foreground shadow-[0_4px_0_var(--cta-edge)] transition-[translate,box-shadow] duration-150 hover:bg-cta active:translate-y-0.5 active:shadow-[0_2px_0_var(--cta-edge)] motion-safe:active:scale-100 intro-tiny:h-12 intro-tiny:text-base intro-landscape:h-11.5 intro-landscape:px-7"
            >
              <span key={labelChanges} className={labelChanges > 0 ? "intro-label-swap" : "inline-block"}>
                {label}
              </span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => onGoTo(lastIndex)}
              tabIndex={showSkip ? undefined : -1}
              data-shown={showSkip ? "" : undefined}
              className="intro-skip min-h-11 self-center rounded-full px-5 text-[15px] font-bold text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
            >
              Pular
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
