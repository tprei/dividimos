"use client";

import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "framer-motion";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { haptics } from "@/hooks/use-haptics";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { INTRO_SEEN_COOKIE } from "@/lib/auth-intro";
import { cn } from "@/lib/utils";
import { INTRO_SLIDES, LOGIN_SLIDE_TITLE, type IntroSlide } from "./intro-slides";
import { IntroNav } from "./intro-nav";
import { LoginSlide } from "./login-slide";
import { EASE_SNAP } from "./scene-motion";
import type { IntroSceneStage } from "./scene-stage";
import { useAutoAdvance, type AutoAdvance } from "./use-auto-advance";
import { useIntroSwipe } from "./use-intro-swipe";

/** Matches Tailwind's `lg` breakpoint, which lays the story and the login side by side. */
const SPLIT_QUERY = "(min-width: 64rem)";
const STORY_COUNT = INTRO_SLIDES.length;
const LOGIN_INDEX = STORY_COUNT;
const SLIDE_TITLES = [...INTRO_SLIDES.map((slide) => slide.title), LOGIN_SLIDE_TITLE];
const SNAP_SECONDS = 0.38;
const SKIP_DELAY_MS = 1000;
const SEEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SCENE_PARALLAX_PERCENT = -10;
const COPY_PARALLAX_PERCENT = 22;

type CarouselPhase =
  | { kind: "settled" }
  | { kind: "moving" }
  | { kind: "returning" }
  | { kind: "dragging"; entered: boolean };

function markIntroSeen() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${INTRO_SEEN_COOKIE}=1; Max-Age=${SEEN_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function stageOf(slide: number, index: number, phase: CarouselPhase): IntroSceneStage {
  if (slide !== index) return "rest";
  if (phase.kind === "settled") return "play";
  if (phase.kind === "moving") return "ready";
  if (phase.kind === "dragging" && !phase.entered) return "ready";
  return "rest";
}

interface IntroCarouselProps {
  playStory: boolean;
}

/**
 * Phones get one carousel whose last slide is the login. From `lg` up the story loops on the left
 * and the login stays on the right; the same login node is only moved by CSS, so nothing remounts.
 */
export function IntroCarousel({ playStory }: IntroCarouselProps) {
  const still = useMediaQuery(REDUCED_MOTION_QUERY);
  const split = useMediaQuery(SPLIT_QUERY);
  const [index, setIndex] = useState(playStory ? 0 : LOGIN_INDEX);
  const [phase, setPhase] = useState<CarouselPhase>({ kind: "settled" });
  // Seeded with the server's answer, so a client-side mount on a wide screen still leaves the login index.
  const [trackedSplit, setTrackedSplit] = useState(false);
  const [loginVisit, setLoginVisit] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const [skipReady, setSkipReady] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const loginRef = useRef<HTMLElement>(null);
  const snap = useRef<AnimationPlaybackControls | null>(null);
  const focusLoginOnSettle = useRef(false);
  const progress = useMotionValue(index);
  const trackX = useTransform(progress, (position) => `${-position * 100}%`);
  const loginX = useTransform(progress, (position) => `${(LOGIN_INDEX - position) * 100}%`);

  if (trackedSplit !== split) {
    setTrackedSplit(split);
    setPhase({ kind: "settled" });
    if (split && index === LOGIN_INDEX) setIndex(0);
  }

  const lastIndex = split ? STORY_COUNT - 1 : LOGIN_INDEX;

  const settleAt = (target: number, kind: "moving" | "returning") => {
    snap.current?.stop();
    snap.current = null;
    if (still) {
      progress.set(target);
      setPhase({ kind: "settled" });
      return;
    }
    setPhase({ kind });
    const controls = animate(progress, target, { duration: SNAP_SECONDS, ease: EASE_SNAP });
    snap.current = controls;
    void controls.finished.then(() => {
      if (snap.current !== controls) return;
      snap.current = null;
      setPhase({ kind: "settled" });
    });
  };

  const goTo = (target: number) => {
    const next = Math.min(lastIndex, Math.max(0, target));
    if (next === index) {
      if (phase.kind !== "settled") settleAt(next, "returning");
      return;
    }
    if (index === LOGIN_INDEX) setLoginVisit((visit) => visit + 1);
    focusLoginOnSettle.current =
      next === LOGIN_INDEX && navRef.current !== null && navRef.current.contains(document.activeElement);
    setIndex(next);
    setAnnouncement(`Slide ${next + 1} de ${split ? STORY_COUNT : SLIDE_TITLES.length}: ${SLIDE_TITLES[next]}`);
    settleAt(next, "moving");
  };

  const step = (direction: 1 | -1) => {
    if (split) goTo((index + direction + STORY_COUNT) % STORY_COUNT);
    else goTo(index + direction);
  };

  const autoAdvance = useAutoAdvance({
    enabled: !still && (split || index < LOGIN_INDEX),
    slide: index,
    onAdvance: () => step(1),
  });

  const swipe = useIntroSwipe({
    stageRef,
    progress,
    index,
    lastIndex,
    onDragStart: () => {
      snap.current?.stop();
      snap.current = null;
      setPhase({ kind: "dragging", entered: phase.kind === "settled" || phase.kind === "returning" });
    },
    onRelease: (target) => {
      setSwiped(true);
      if (target !== index) {
        haptics.tap();
        goTo(target);
        return;
      }
      const entered = phase.kind === "dragging" && phase.entered;
      settleAt(index, entered ? "returning" : "moving");
    },
  });

  const syncedSplit = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (syncedSplit.current === split) return;
    syncedSplit.current = split;
    snap.current?.stop();
    snap.current = null;
    progress.set(index);
  }, [split, index, progress]);

  useEffect(() => {
    if (split) markIntroSeen();
  }, [split]);

  useEffect(() => {
    if (!playStory) return;
    const timer = window.setTimeout(() => setSkipReady(true), SKIP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [playStory]);

  useEffect(() => {
    if (index === LOGIN_INDEX) markIntroSeen();
  }, [index]);

  useEffect(() => {
    const stopSnap = () => snap.current?.stop();
    return stopSnap;
  }, []);

  useEffect(() => {
    if (phase.kind !== "settled" || index !== LOGIN_INDEX || !focusLoginOnSettle.current) return;
    focusLoginOnSettle.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>("[data-google-sign-in]")?.focus({ preventScroll: true });
  }, [phase, index]);

  const onArrowKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("input, select, textarea") !== null) return;
    if (event.target instanceof Node && loginRef.current?.contains(event.target)) return;
    event.preventDefault();
    step(event.key === "ArrowRight" ? 1 : -1);
  });

  const { resume } = autoAdvance;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onArrowKey(event);
    const release = () => resume("press");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [resume]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) autoAdvance.pause("focus");
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      autoAdvance.resume("focus");
    }
  };

  const onStoryEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (split && event.pointerType === "mouse") autoAdvance.pause("hover");
  };

  const onStoryLeave = (event: PointerEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    const stillOverStory =
      next instanceof Node && [stageRef.current, navRef.current].some((area) => area?.contains(next));
    if (!stillOverStory) autoAdvance.resume("hover");
  };

  const loginStage = split ? "play" : stageOf(LOGIN_INDEX, index, phase);

  return (
    <div
      ref={rootRef}
      className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden lg:grid-cols-[58fr_42fr]"
      onPointerDownCapture={() => autoAdvance.pause("press")}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div
        ref={stageRef}
        {...swipe}
        onPointerEnter={onStoryEnter}
        onPointerLeave={onStoryLeave}
        onDragStart={(event) => event.preventDefault()}
        data-at-login={index === LOGIN_INDEX ? "" : undefined}
        className={cn(
          "relative min-h-0 touch-pan-y touch-pinch-zoom overflow-hidden select-none [grid-area:1/1] lg:[&[data-at-login]>div]:transform-none!",
          phase.kind === "dragging" ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <motion.div key={split ? "split" : "phone"} className="flex h-full" style={{ x: trackX }}>
          {INTRO_SLIDES.map((slide, slideIndex) => (
            <StorySlide
              key={slide.title}
              slide={slide}
              slideIndex={slideIndex}
              slideCount={split ? STORY_COUNT : SLIDE_TITLES.length}
              current={slideIndex === index}
              stage={stageOf(slideIndex, index, phase)}
              progress={progress}
              still={still}
              autoAdvance={autoAdvance}
            />
          ))}
        </motion.div>
      </div>
      <motion.section
        ref={loginRef}
        {...(split ? {} : swipe)}
        role={split ? "region" : "group"}
        aria-roledescription={split ? undefined : "slide"}
        aria-label={split ? LOGIN_SLIDE_TITLE : `${LOGIN_INDEX + 1} de ${SLIDE_TITLES.length}`}
        inert={!split && index !== LOGIN_INDEX}
        style={{ x: loginX }}
        className="min-h-0 min-w-0 [grid-area:1/1] lg:border-l lg:border-border lg:bg-surface lg:transform-none! lg:[grid-area:1/2/3/3]"
      >
        <LoginSlide key={loginVisit} stage={loginStage} />
      </motion.section>
      <div ref={navRef} className="[grid-area:2/1]" onPointerEnter={onStoryEnter} onPointerLeave={onStoryLeave}>
        <IntroNav
          index={index}
          titles={SLIDE_TITLES}
          counting={autoAdvance.counting}
          cycle={autoAdvance.cycle}
          showSkip={playStory && skipReady && index !== LOGIN_INDEX}
          showCue={playStory && !swiped && index !== LOGIN_INDEX}
          onGoTo={goTo}
          onStep={step}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

interface StorySlideProps {
  slide: IntroSlide;
  slideIndex: number;
  slideCount: number;
  current: boolean;
  stage: IntroSceneStage;
  progress: MotionValue<number>;
  still: boolean;
  autoAdvance: AutoAdvance;
}

function StorySlide({ slide, slideIndex, slideCount, current, stage, progress, still, autoAdvance }: StorySlideProps) {
  const offset = useTransform(progress, (position) => {
    const distance = slideIndex - position;
    return still || Math.abs(distance) >= 1.02 ? 0 : distance;
  });
  const sceneX = useTransform(offset, (distance) => `${distance * SCENE_PARALLAX_PERCENT}%`);
  const copyX = useTransform(offset, (distance) => `${distance * COPY_PARALLAX_PERCENT}%`);
  const { Scene } = slide;

  return (
    <section
      role="group"
      aria-roledescription="slide"
      aria-label={`${slideIndex + 1} de ${slideCount}`}
      inert={!current}
      onContextMenu={(event) => event.preventDefault()}
      className="flex h-full w-full shrink-0 flex-col overflow-hidden px-5.5 pt-3.5 [contain:layout_style_paint] intro-tiny:pt-2 intro-landscape:flex-row intro-landscape:items-center intro-landscape:gap-5 intro-landscape:px-7 intro-landscape:pt-2 lg:px-16 lg:pt-11"
    >
      <motion.div
        data-intro-scene=""
        className="flex min-h-0 flex-1 items-center justify-center intro-landscape:h-full intro-landscape:basis-[52%]"
        style={{ x: sceneX }}
      >
        <Scene stage={stage} onSettle={autoAdvance.settle} onBusy={autoAdvance.busy} />
      </motion.div>
      <motion.div
        className="flex-none px-1.5 pt-1.5 pb-2.5 text-center intro-tiny:pb-1 intro-landscape:basis-[48%] intro-landscape:text-left lg:pt-4.5"
        style={{ x: copyX }}
      >
        <h2 className="text-[28px] leading-[1.12] font-black tracking-[-0.025em] text-balance intro-short:text-[25px] intro-tiny:text-[23px] lg:text-[34px]">
          {slide.title}
        </h2>
        <p className="mx-auto mt-2 max-w-[32ch] text-base leading-[1.45] text-pretty text-muted-foreground intro-short:mt-1.5 intro-short:text-[15px] intro-tiny:text-[14.5px] intro-tiny:leading-[1.4] intro-landscape:ml-0 lg:max-w-[40ch] lg:text-[17px]">
          {slide.support}
        </p>
      </motion.div>
    </section>
  );
}
