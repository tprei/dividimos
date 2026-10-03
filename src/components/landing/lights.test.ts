// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { switchLights } from "./lights";

vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => false }));

interface FakeTransition {
  update: () => void;
  finished: Promise<void>;
  resolveFinished: () => void;
  rejectFinished: (reason: unknown) => void;
}

const originalMatchMedia = window.matchMedia.bind(window);
let pending: FakeTransition[] = [];

function stubDeviceMedia(options: { reducedMotion?: boolean; desktop?: boolean } = {}): void {
  const { reducedMotion = false, desktop = true } = options;
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const media = originalMatchMedia(query);
    const matches =
      query === "(prefers-reduced-motion: reduce)"
        ? reducedMotion
        : query ===
            "(min-width: 760px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
          ? desktop && !reducedMotion
          : false;
    Object.defineProperty(media, "matches", {
      value: matches,
      configurable: true,
    });
    return media;
  });
}

function stubReducedMotion(reduced: boolean): void {
  stubDeviceMedia({ reducedMotion: reduced, desktop: true });
}

function stubStartViewTransition(): FakeTransition[] {
  const transitions: FakeTransition[] = [];
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: (update: () => void) => {
      let resolveFinished!: () => void;
      let rejectFinished!: (reason: unknown) => void;
      const finished = new Promise<void>((resolve, reject) => {
        resolveFinished = resolve;
        rejectFinished = reject;
      });
      const transition: FakeTransition = { update, finished, resolveFinished, rejectFinished };
      transitions.push(transition);
      return { finished };
    },
  });
  pending = transitions;
  return transitions;
}

function flushTransition(transition: FakeTransition): Promise<void> {
  return transition.finished.catch(() => {});
}

afterEach(async () => {
  const unsettled = pending.splice(0);
  pending = [];
  for (const transition of unsettled) transition.resolveFinished();
  for (const transition of unsettled) await flushTransition(transition);
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "startViewTransition");
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-lights");
  document.documentElement.style.colorScheme = "";
  for (const name of ["--lights-x", "--lights-y", "--lights-r"]) {
    document.documentElement.style.removeProperty(name);
  }
});

describe("switchLights", () => {
  it("alternates rapid toggles that land before the first callback runs", () => {
    document.documentElement.classList.add("dark");
    stubReducedMotion(false);
    const transitions = stubStartViewTransition();

    switchLights(document.createElement("div"));
    switchLights(document.createElement("div"));

    expect(transitions).toHaveLength(2);
    transitions[0].update();
    transitions[1].update();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("marks the reveal and clears it once the transition settles", async () => {
    document.documentElement.classList.add("dark");
    stubReducedMotion(false);
    const transitions = stubStartViewTransition();

    switchLights(document.createElement("div"));

    expect(document.documentElement.getAttribute("data-lights")).toBe("on");
    for (const name of ["--lights-x", "--lights-y", "--lights-r"]) {
      expect(document.documentElement.style.getPropertyValue(name)).toMatch(/px$/);
    }

    transitions[0].resolveFinished();
    await flushTransition(transitions[0]);

    expect(document.documentElement.hasAttribute("data-lights")).toBe(false);
    for (const name of ["--lights-x", "--lights-y", "--lights-r"]) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe("");
    }
  });

  it("lets only the latest transition clear the reveal", async () => {
    document.documentElement.classList.add("dark");
    stubReducedMotion(false);
    const transitions = stubStartViewTransition();

    switchLights(document.createElement("div"));
    switchLights(document.createElement("div"));
    transitions[1].update();

    transitions[0].resolveFinished();
    await flushTransition(transitions[0]);

    expect(document.documentElement.getAttribute("data-lights")).toBe("off");
    expect(document.documentElement.style.getPropertyValue("--lights-r")).toMatch(/px$/);

    transitions[1].resolveFinished();
    await flushTransition(transitions[1]);

    expect(document.documentElement.hasAttribute("data-lights")).toBe(false);
  });

  it("clears the reveal when the transition fails", async () => {
    document.documentElement.classList.add("dark");
    stubReducedMotion(false);
    const transitions = stubStartViewTransition();

    switchLights(document.createElement("div"));
    transitions[0].update();
    transitions[0].rejectFinished(new Error("transition skipped"));
    await flushTransition(transitions[0]);

    expect(document.documentElement.hasAttribute("data-lights")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("flips the theme synchronously under reduced motion", () => {
    document.documentElement.classList.add("dark");
    stubReducedMotion(true);
    const transitions = stubStartViewTransition();

    switchLights(document.createElement("div"));

    expect(transitions).toHaveLength(0);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.hasAttribute("data-lights")).toBe(false);
  });

  it("flips the theme synchronously and alternates rapidly on mobile or coarse pointer", () => {
    document.documentElement.classList.add("dark");
    stubDeviceMedia({ desktop: false, reducedMotion: false });
    const transitions = stubStartViewTransition();

    const origin = document.createElement("div");
    switchLights(origin);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");

    switchLights(origin);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    switchLights(origin);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");

    expect(transitions).toHaveLength(0);
    expect(document.documentElement.hasAttribute("data-lights")).toBe(false);
  });

  it("ignores obsolete queued desktop transitions when subsequent synchronous toggles occur", () => {
    document.documentElement.classList.add("dark");
    stubDeviceMedia({ desktop: true, reducedMotion: false });
    const transitions = stubStartViewTransition();
    const origin = document.createElement("div");

    switchLights(origin);
    expect(transitions).toHaveLength(1);

    stubDeviceMedia({ desktop: false, reducedMotion: false });
    switchLights(origin);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    switchLights(origin);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");

    transitions[0].update();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
