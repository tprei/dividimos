"use client";

import { Keyboard } from "@capacitor/keyboard";
import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/capacitor/auth";

/**
 * Single owner of the app's visual-viewport geometry.
 *
 * On phones the visual viewport is the only honest source for "how much screen
 * can I actually draw on": the layout viewport keeps its full height while the
 * keyboard covers half of it. Every overlay reads the published custom
 * properties instead of measuring on its own, so a dialog, a popover, and the
 * shell never disagree about where the bottom of the screen is.
 * `data-keyboard="open"` on the document element is the CSS-side mirror of
 * `keyboardOpen`, so overlays can compress with a Tailwind variant instead of
 * branching in JS.
 */

const HEIGHT_VAR = "--app-viewport-height";
const TOP_VAR = "--app-viewport-top";
const WIDTH_VAR = "--app-viewport-width";
const KEYBOARD_ATTR = "data-keyboard";

/**
 * The shell is not the only caller: chat sheets mount the hook too. Each
 * instance reports the same geometry, but they mount and unmount at different
 * moments, so the attribute is refcounted. Otherwise a sheet closing while the
 * keyboard is still up would clear the flag under the shell.
 */
let keyboardOpenInstances = 0;

function registerKeyboardOpen(): () => void {
  keyboardOpenInstances += 1;
  document.documentElement.setAttribute(KEYBOARD_ATTR, "open");
  return () => {
    keyboardOpenInstances = Math.max(0, keyboardOpenInstances - 1);
    if (keyboardOpenInstances === 0) {
      document.documentElement.removeAttribute(KEYBOARD_ATTR);
    }
  };
}

/** Below this drop the shrink is a browser chrome change, not a keyboard. */
const KEYBOARD_THRESHOLD_PX = 150;

/** Pinch zoom moves the visual viewport without changing the app's layout. */
const SCALE_EPSILON = 0.01;

const NON_TEXT_INPUT_TYPES: Record<string, true> = {
  button: true,
  checkbox: true,
  color: true,
  file: true,
  hidden: true,
  image: true,
  radio: true,
  range: true,
  reset: true,
  submit: true,
};

function isTextEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return NON_TEXT_INPUT_TYPES[element.type] !== true;
  }
  return false;
}

function orientationKey(): string {
  const type = window.screen?.orientation?.type;
  if (type) return type.startsWith("landscape") ? "landscape" : "portrait";
  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
}

export function useAppViewport(): { keyboardOpen: boolean } {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const previous = {
      height: root.style.getPropertyValue(HEIGHT_VAR),
      top: root.style.getPropertyValue(TOP_VAR),
      width: root.style.getPropertyValue(WIDTH_VAR),
    };

    const native = isNativePlatform();
    let frame = 0;
    let orientation = orientationKey();
    // Tallest unobstructed height seen in this orientation. It only grows, so
    // a keyboard that is still closing cannot be mistaken for more free space.
    let restingHeight = 0;

    const apply = () => {
      frame = 0;
      const vv = window.visualViewport;

      // Frozen while the user pinches: the app keeps its scale-one layout and
      // the browser handles the zoom, so nothing here fights the gesture.
      if (vv && Math.abs(vv.scale - 1) > SCALE_EPSILON) return;

      const height = vv?.height ?? window.innerHeight;
      const width = vv?.width ?? window.innerWidth;
      const top = vv?.offsetTop ?? 0;

      root.style.setProperty(HEIGHT_VAR, `${height}px`);
      root.style.setProperty(TOP_VAR, `${top}px`);
      root.style.setProperty(WIDTH_VAR, `${width}px`);

      const currentOrientation = orientationKey();
      if (currentOrientation !== orientation) {
        orientation = currentOrientation;
        restingHeight = height;
      }

      // The native keyboard plugin reports visibility directly; the WebView is
      // resized for us, so re-deriving it here would only add a second answer.
      if (native) return;

      const shrunk = restingHeight - height > KEYBOARD_THRESHOLD_PX;
      if (!shrunk) {
        restingHeight = Math.max(restingHeight, height);
        setKeyboardOpen(false);
        return;
      }
      // Opening requires a focused text field. Closing does not: after blur the
      // keyboard is still on screen, and hiding it early flashes the navigation
      // bar over a keyboard that has not finished sliding away.
      if (isTextEditable(document.activeElement)) setKeyboardOpen(true);
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(apply);
    };

    restingHeight = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
    apply();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);

    let disposed = false;
    let removePluginListeners: (() => void) | undefined;

    if (native) {
      const attach = async () => {
        const show = await Keyboard.addListener("keyboardWillShow", () => setKeyboardOpen(true));
        const hide = await Keyboard.addListener("keyboardWillHide", () => setKeyboardOpen(false));
        return () => {
          void show.remove();
          void hide.remove();
        };
      };

      void attach()
        .then((remove) => {
          if (disposed) {
            remove();
            return;
          }
          removePluginListeners = remove;
        })
        // A plugin that refuses to register leaves the published geometry in
        // place; it must not surface as an unhandled rejection.
        .catch(() => undefined);
    }

    return () => {
      disposed = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", schedule);
      removePluginListeners?.();

      // A later non-app route must not inherit this app's keyboard geometry.
      for (const [name, value] of [
        [HEIGHT_VAR, previous.height],
        [TOP_VAR, previous.top],
        [WIDTH_VAR, previous.width],
      ] as const) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
    };
  }, []);

  useEffect(() => {
    if (!keyboardOpen) return;
    return registerKeyboardOpen();
  }, [keyboardOpen]);

  return { keyboardOpen };
}
