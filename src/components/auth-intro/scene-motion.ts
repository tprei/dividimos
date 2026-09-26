import { animate, type AnimationPlaybackControls, type EasingDefinition } from "framer-motion";

export const EASE_SNAP: EasingDefinition = [0.22, 1, 0.36, 1];
export const EASE_SPRING: EasingDefinition = [0.34, 1.56, 0.64, 1];
export const EASE_OUT: EasingDefinition = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: EasingDefinition = [0.65, 0, 0.35, 1];

/** Overshoots by ~10% and settles; cubic-bezier can't express the prototype's curve. */
export function easeBack(t: number): number {
  return 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
}

export function bump(node: Element): AnimationPlaybackControls {
  return animate(node, { scale: [1, 1.05, 1] }, { duration: 0.46, times: [0, 0.3, 1], ease: EASE_SPRING });
}

export function press(node: Element): AnimationPlaybackControls {
  return animate(node, { scale: [1, 0.88, 1] }, { duration: 0.34, times: [0, 0.35, 1], ease: EASE_SPRING });
}

export function wiggle(node: Element): AnimationPlaybackControls {
  return animate(
    node,
    { rotate: [0, -1.4, 1, 0], scale: [1, 1.015, 1.01, 1] },
    { duration: 0.46, times: [0, 0.3, 0.65, 1], ease: EASE_SPRING },
  );
}

export function popIn(node: Element): AnimationPlaybackControls {
  return animate([
    [node, { scale: [0.2, 1] }, { duration: 0.42, ease: EASE_SPRING }],
    [node, { opacity: [0, 1, 1] }, { duration: 0.42, times: [0, 0.6, 1], ease: EASE_SPRING, at: 0 }],
  ]);
}

/**
 * Tracks every animation and timer a scene run starts, so a stage change can end all of them at once.
 * `play` animations stop where they are (the scene then paints its own frame); `flourish` ones jump
 * to their last keyframe, so a cut-short pop or bump never leaves a node scaled.
 */
export interface SceneClock {
  wait(ms: number): Promise<void>;
  play(controls: AnimationPlaybackControls): Promise<void>;
  flourish(controls: AnimationPlaybackControls): void;
  stop(): void;
}

export function createSceneClock(): SceneClock {
  const running = new Set<AnimationPlaybackControls>();
  const flourishes = new Set<AnimationPlaybackControls>();
  const timers = new Set<number>();
  let stopped = false;

  return {
    wait(ms) {
      return new Promise((resolve) => {
        if (stopped) return;
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, ms);
        timers.add(timer);
      });
    },
    play(controls) {
      if (stopped) {
        controls.stop();
        return new Promise(() => {});
      }
      running.add(controls);
      return controls.finished.then(() => {
        running.delete(controls);
      });
    },
    flourish(controls) {
      if (stopped) {
        controls.complete();
        return;
      }
      flourishes.add(controls);
      void controls.finished.then(() => flourishes.delete(controls));
    },
    stop() {
      stopped = true;
      running.forEach((controls) => controls.stop());
      running.clear();
      flourishes.forEach((controls) => controls.complete());
      flourishes.clear();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    },
  };
}

/** Owns the scene's current run: starting a new one stops the previous. */
export interface SceneRunner {
  start(): SceneClock;
  stop(): void;
}

export function createSceneRunner(): SceneRunner {
  let current: SceneClock | null = null;
  return {
    start() {
      current?.stop();
      current = createSceneClock();
      return current;
    },
    stop() {
      current?.stop();
      current = null;
    },
  };
}
