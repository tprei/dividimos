import { useSyncExternalStore } from "react";
import { setThemePreference } from "@/lib/theme";

let activeTransition: ViewTransition | null = null;
let requestedOn: boolean | null = null;

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function readLightsOn(): boolean {
  return !document.documentElement.classList.contains("dark");
}

function readServerLightsOn(): boolean | null {
  return null;
}

export function useLightsOn(): boolean | null {
  return useSyncExternalStore(subscribeToTheme, readLightsOn, readServerLightsOn);
}

function markReveal(root: HTMLElement, origin: Element, turningOn: boolean): void {
  const box = origin.getBoundingClientRect();
  root.style.setProperty("--lights-x", `${box.left + box.width / 2}px`);
  root.style.setProperty("--lights-y", `${box.top + box.height / 2}px`);
  root.style.setProperty("--lights-r", `${Math.hypot(window.innerWidth, window.innerHeight)}px`);
  root.dataset.lights = turningOn ? "on" : "off";
}

function clearReveal(root: HTMLElement): void {
  root.style.removeProperty("--lights-x");
  root.style.removeProperty("--lights-y");
  root.style.removeProperty("--lights-r");
  delete root.dataset.lights;
}

export function switchLights(origin: Element): void {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("startViewTransition" in document)) {
    setThemePreference(readLightsOn() ? "dark" : "light");
    return;
  }
  const turningOn = !(requestedOn ?? readLightsOn());
  requestedOn = turningOn;
  const flip = (): void => {
    setThemePreference(turningOn ? "light" : "dark");
  };
  markReveal(root, origin, turningOn);
  const transition = document.startViewTransition(flip);
  activeTransition = transition;
  const settle = (): void => {
    if (activeTransition !== transition) return;
    activeTransition = null;
    requestedOn = null;
    clearReveal(root);
  };
  void transition.finished.then(settle, settle);
}
