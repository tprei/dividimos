import { describe, expect, it } from "vitest";
import {
  classifyPress,
  clickGuardAfterRelease,
  dragTrackX,
  pushSample,
  releaseTarget,
  releaseVelocity,
  rubberBand,
} from "./intro-swipe";

const WIDTH = 390;

describe("classifyPress", () => {
  it("keeps 8px of travel a tap and turns 9px sideways into a drag", () => {
    expect(classifyPress(8, 0)).toBe("pending");
    expect(classifyPress(-9, 2)).toBe("drag");
  });

  it("treats mostly vertical travel as a scroll only past the slop", () => {
    expect(classifyPress(3, 8)).toBe("pending");
    expect(classifyPress(6, 12)).toBe("scroll");
    expect(classifyPress(10, 12)).toBe("scroll");
  });
});

describe("clickGuardAfterRelease", () => {
  it("lets a quick, still tap through", () => {
    expect(clickGuardAfterRelease({ intent: "pending", distancePx: 3, durationMs: 120 })).toBe("none");
  });

  it("keeps a long press away from scene objects only", () => {
    expect(clickGuardAfterRelease({ intent: "pending", distancePx: 2, durationMs: 400 })).toBe("scene");
  });

  it("swallows every click after a swipe, a scroll or a press that wandered", () => {
    expect(clickGuardAfterRelease({ intent: "drag", distancePx: 2, durationMs: 90 })).toBe("all");
    expect(clickGuardAfterRelease({ intent: "scroll", distancePx: 30, durationMs: 90 })).toBe("all");
    expect(clickGuardAfterRelease({ intent: "pending", distancePx: 8, durationMs: 90 })).toBe("all");
  });
});

describe("releaseTarget", () => {
  const at = (offsetPx: number, velocity: number, index = 1) =>
    releaseTarget({ index, offsetPx, velocity, widthPx: WIDTH, lastIndex: 3 });

  it("advances on a short, fast flick", () => {
    expect(at(20, 0.6)).toBe(2);
    expect(at(-20, -0.6)).toBe(0);
  });

  it("snaps back from a slow, short drag", () => {
    expect(at(60, 0.1)).toBe(1);
    expect(at(-60, -0.1)).toBe(1);
  });

  it("advances once the drag passes a fifth of the width", () => {
    expect(at(WIDTH * 0.21, 0)).toBe(2);
    expect(at(-WIDTH * 0.21, 0)).toBe(0);
  });

  it("ignores a flick against the drag direction", () => {
    expect(at(40, -0.8)).toBe(1);
  });

  it("never leaves the slides", () => {
    expect(at(WIDTH * 0.5, 1, 3)).toBe(3);
    expect(at(-WIDTH * 0.5, -1, 0)).toBe(0);
  });
});

describe("releaseVelocity", () => {
  it("measures leftward finger travel as positive", () => {
    const samples = [
      { t: 0, x: 300 },
      { t: 50, x: 250 },
    ];
    expect(releaseVelocity(samples, 60)).toBe(1);
  });

  it("reads a finger that stopped before lifting as still", () => {
    const samples = [
      { t: 0, x: 300 },
      { t: 50, x: 200 },
    ];
    expect(releaseVelocity(samples, 140)).toBe(0);
    expect(releaseVelocity([], 10)).toBe(0);
  });

  it("only measures the last 100ms of travel", () => {
    let samples = pushSample([], { t: 0, x: 400 });
    samples = pushSample(samples, { t: 100, x: 390 });
    samples = pushSample(samples, { t: 150, x: 380 });
    samples = pushSample(samples, { t: 200, x: 330 });

    expect(samples[0].t).toBe(100);
    expect(releaseVelocity(samples, 200)).toBe(0.6);
  });
});

describe("rubber banding", () => {
  it("resists past the ends and grows with the pull", () => {
    const small = rubberBand(50, WIDTH);
    const large = rubberBand(200, WIDTH);

    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(50);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(200);
  });

  it("applies to the track before the first slide and after the last", () => {
    expect(dragTrackX({ baseX: 0, deltaPx: 100, widthPx: WIDTH, lastIndex: 3 })).toBe(-rubberBand(100, WIDTH));
    expect(dragTrackX({ baseX: WIDTH * 3, deltaPx: -100, widthPx: WIDTH, lastIndex: 3 })).toBe(
      WIDTH * 3 + rubberBand(100, WIDTH),
    );
    expect(dragTrackX({ baseX: WIDTH, deltaPx: 100, widthPx: WIDTH, lastIndex: 3 })).toBe(WIDTH - 100);
  });
});
