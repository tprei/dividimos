#!/usr/bin/env node
// Guards the native shell's keyboard/viewport geometry on a booted Android
// emulator, against a debug APK built with CAPACITOR_DEV=true LAN_IP=127.0.0.1
// so the WebView loads this repo's e2e/native-shell/index.html from
// http://127.0.0.1:3000. The fixture reports its own geometry as VPTEST
// console lines, which Capacitor pipes to logcat; the shell's contribution is
// read off the device (uiautomator WebView bounds, wm size, dumpsys
// input_method). Pure-browser synthetics cannot catch these regressions: no
// native shell ever resizes their viewport.
//
// Usage:
//   [ADB=<path-to-adb>] [PKG=ai.dividimos.app] [SERVER_PORT=3000] \
//     node scripts/native-shell-keyboard-guard.mjs
//
// SERVER_PORT is the host port adb reverse forwards to. The device-side port
// is fixed at 3000 because that is what `cap sync` bakes into the APK.
//
// Asserts, with the tolerances the shipped regressions were measured at:
//   A keyboard open: keyboard top and WebView bottom meet (physical px)
//   B keyboard open: visualViewport shrank by exactly the space the shell freed
//   C keyboard closed: visualViewport returned to its resting height
//   D HOME + relaunch with the field focused: keyboard back, viewport shrunk

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ADB = process.env.ADB ?? "adb";
const PKG = process.env.PKG ?? "ai.dividimos.app";
const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
const DEVICE_PORT = 3000;
const ARTIFACT_DIR = "native-shell-guard-artifacts";

const TOLERANCE = { a: 8, b: 4, c: 2, d: 4 };

const VPTEST_LINE = /VPTEST (\S+) inner=(\d+) vv=(\d+) dpr=([\d.]+) kb=(\d+)/;

class GuardError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adbText(args, { timeout = 60_000 } = {}) {
  return execFileSync(ADB, args, { encoding: "utf8", timeout }).trim();
}

function shell(command) {
  return adbText(["shell", command]);
}

let consumedVptestLines = 0;

function readVptestLines() {
  return adbText(["logcat", "-d", "-v", "time", "-s", "Capacitor/Console:*"])
    .split(/\r?\n/)
    .filter((line) => line.includes("VPTEST "));
}

/** Returns VPTEST lines logged since the previous call, oldest first. */
function drainVptestLines() {
  const all = readVptestLines();
  const fresh = all.slice(consumedVptestLines);
  consumedVptestLines = all.length;
  return fresh;
}

function parseVptest(line) {
  const match = VPTEST_LINE.exec(line);
  if (!match) return null;
  return {
    tag: match[1],
    inner: Number(match[2]),
    vv: Number(match[3]),
    dpr: Number(match[4]),
    kb: Number(match[5]),
  };
}

async function waitForTag(tags, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let tail = [];
  while (Date.now() < deadline) {
    const lines = drainVptestLines();
    tail = [...tail, ...lines].slice(-10);
    for (const line of lines) {
      const parsed = parseVptest(line);
      if (parsed && tags.includes(parsed.tag)) return parsed;
    }
    await sleep(400);
  }
  throw new GuardError(
    `timed out after ${timeoutMs / 1000}s waiting for a ${what} VPTEST line` +
      (tail.length ? `; last lines:\n  ${tail.join("\n  ")}` : ""),
  );
}

/** Latest measurement logged since the previous call, if any. */
function latestVptest(fallback) {
  const parsed = drainVptestLines().map(parseVptest).filter(Boolean);
  return parsed.length ? parsed[parsed.length - 1] : fallback;
}

function waitForBoot() {
  adbText(
    [
      "wait-for-device",
      "shell",
      'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 2; done',
    ],
    { timeout: 240_000 },
  );
}

function wakeEmulator() {
  // The CI emulator boots headless with the screen off, possibly on the
  // keyguard; taps and IME focus do nothing in that state.
  shell("svc power stayon true");
  shell("input keyevent KEYCODE_WAKEUP");
  shell("wm dismiss-keyguard");
}

function startApp() {
  shell(`am force-stop ${PKG}`);
  shell(`am start -n ${PKG}/.MainActivity`);
}

function bringAppToFront() {
  // No force-stop: the HOME→relaunch check depends on Android restoring the
  // task with the input still focused, which re-opens the keyboard.
  shell(`am start -n ${PKG}/.MainActivity`);
}

function screenPixels() {
  const output = shell("wm size");
  const sizes = [
    ...output.matchAll(/(Physical|Override) size: (\d+)x(\d+)/g),
  ].map((match) => ({
    kind: match[1],
    w: Number(match[2]),
    h: Number(match[3]),
  }));
  const chosen = sizes.find(({ kind }) => kind === "Override") ?? sizes[0];
  if (!chosen) throw new GuardError(`cannot parse "wm size" output: ${output}`);
  return chosen;
}

function tapScreenCenter() {
  const { w, h } = screenPixels();
  shell(`input tap ${Math.round(w / 2)} ${Math.round(h / 2)}`);
}

async function webviewBounds() {
  for (let attempt = 0; attempt < 3; attempt++) {
    shell("uiautomator dump /sdcard/vptest-dump.xml >/dev/null 2>&1");
    const xml = shell("cat /sdcard/vptest-dump.xml");
    const boxes = [...xml.matchAll(/<node\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((node) => node.includes('class="android.webkit.WebView"'))
      .flatMap((node) => [
        ...node.matchAll(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g),
      ])
      .map((match) => ({
        left: Number(match[1]),
        top: Number(match[2]),
        right: Number(match[3]),
        bottom: Number(match[4]),
      }));
    // The container is the largest WebView-class node; accessibility children
    // can repeat the class at smaller bounds.
    if (boxes.length) {
      return boxes.reduce((a, b) =>
        (b.right - b.left) * (b.bottom - b.top) >
        (a.right - a.left) * (a.bottom - a.top)
          ? b
          : a,
      );
    }
    // uiautomator refuses to dump while the IME animation is still settling.
    await sleep(1000);
  }
  throw new GuardError("no android.webkit.WebView node in the uiautomator dump");
}

function imeShown() {
  const output = shell("dumpsys input_method");
  const match = /mInputShown=(true|false)/.exec(output);
  if (!match) {
    throw new GuardError("cannot read mInputShown from dumpsys input_method");
  }
  return match[1] === "true";
}

function screenshot(name) {
  writeFileSync(join(ARTIFACT_DIR, name), execFileSync(ADB, ["exec-out", "screencap", "-p"]));
}

/**
 * Launches the app, lets the resting viewport settle, and opens the keyboard
 * with a center tap.
 *
 * @returns {{ rest: object, restBounds: object, didShow: object }} resting
 *   VPTEST measurement, resting WebView bounds, and keyboard-open VPTEST
 *   measurement
 */
async function launchWithKeyboard() {
  // The first launch after a cold boot is flaky: the page sometimes loads but
  // never becomes interactive, so the tap opens no keyboard. Retrying the
  // whole cycle once fixes it; failing twice is a real error.
  for (let attempt = 1; attempt <= 2; attempt++) {
    startApp();
    try {
      const load = await waitForTag(["load"], 25_000, "page load");
      await sleep(1500);
      const rest = latestVptest(load);
      const restBounds = await webviewBounds();
      screenshot("rest.png");
      tapScreenCenter();
      const didShow = await waitForTag(["didShow"], 20_000, "keyboardDidShow");
      return { rest, restBounds, didShow };
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`first launch cycle failed (${error.message}); retrying`);
    }
  }
  throw new GuardError("unreachable");
}

async function runScenario() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  waitForBoot();
  wakeEmulator();
  // The APK loads http://127.0.0.1:3000 on-device; reverse maps that device
  // port to the host's static file server (SERVER_PORT).
  adbText(["reverse", `tcp:${DEVICE_PORT}`, `tcp:${SERVER_PORT}`]);
  adbText(["logcat", "-c"]);

  const { rest, restBounds, didShow } = await launchWithKeyboard();
  await sleep(1000);
  const bounds = await webviewBounds();
  const keyboardIme = imeShown();
  screenshot("keyboard.png");

  shell("input keyevent 4"); // KEYCODE_BACK dismisses the keyboard.
  const didHide = await waitForTag(["didHide"], 15_000, "keyboardDidHide");
  await sleep(1000);
  const closed = latestVptest(didHide);
  screenshot("rest.png");

  tapScreenCenter();
  await waitForTag(["didShow"], 20_000, "keyboardDidShow after refocus");
  shell("input keyevent 3"); // KEYCODE_HOME
  await sleep(1000);
  drainVptestLines();
  bringAppToFront();
  await sleep(6000);
  const resumed = drainVptestLines().map(parseVptest).filter(Boolean);
  if (!resumed.length) {
    throw new GuardError("no VPTEST line after relaunching from HOME");
  }
  // Prefer the newest line carrying the keyboard height: visibilitychange
  // fires before keyboardDidShow, while kb still reads 0.
  const resume = resumed.filter((line) => line.kb > 0).at(-1) ?? resumed.at(-1);
  const resumeIme = imeShown();
  screenshot("resume.png");

  return {
    screen: screenPixels(),
    rest,
    restBounds,
    didShow,
    bounds,
    keyboardIme,
    closed,
    resume,
    resumeIme,
  };
}

function assertGeometry(state) {
  const { screen, rest, restBounds, didShow, bounds, closed, resume, resumeIme } =
    state;
  const keyboardTop = screen.h - didShow.kb * didShow.dpr;
  // The IME inset subsumes the nav-bar inset (the IME draws over the nav-bar
  // zone on gesture navigation), so the freed space is the plugin's keyboard
  // height minus the nav bar. Anchoring B and D to the window space the shell
  // actually freed keeps them device-independent: a double subtraction misses
  // the freed space by another keyboard height either way.
  const freedCss = (restBounds.bottom - bounds.bottom) / didShow.dpr;
  const openVv = rest.vv - freedCss;
  return [
    {
      id: "A",
      label: "keyboard open: WebView bottom meets keyboard top",
      detail: `|(screen_h ${screen.h} - kb ${didShow.kb} x dpr ${didShow.dpr}) - webview_bottom ${bounds.bottom}| = ${Math.abs(keyboardTop - bounds.bottom)} px (tolerance ${TOLERANCE.a})`,
      pass: Math.abs(keyboardTop - bounds.bottom) <= TOLERANCE.a,
    },
    {
      id: "B",
      label: "keyboard open: vv shrank by the freed window space",
      detail: `|vv_kb ${didShow.vv} - (vv_rest ${rest.vv} - freed ${(restBounds.bottom - bounds.bottom)} px / dpr = ${freedCss.toFixed(1)})| = ${Math.abs(didShow.vv - openVv).toFixed(1)} css px (tolerance ${TOLERANCE.b})`,
      pass: Math.abs(didShow.vv - openVv) <= TOLERANCE.b,
    },
    {
      id: "C",
      label: "keyboard closed: vv back at resting height",
      detail: `|vv_closed ${closed.vv} - vv_rest ${rest.vv}| = ${Math.abs(closed.vv - rest.vv)} css px (tolerance ${TOLERANCE.c})`,
      pass: Math.abs(closed.vv - rest.vv) <= TOLERANCE.c,
    },
    {
      id: "D",
      label: "relaunch from HOME: keyboard back, vv shrunk",
      detail: `|vv_resume ${resume.vv} - open_vv ${openVv.toFixed(1)}| = ${Math.abs(resume.vv - openVv).toFixed(1)} css px (tolerance ${TOLERANCE.d}), mInputShown=${resumeIme}`,
      pass: Math.abs(resume.vv - openVv) <= TOLERANCE.d && resumeIme,
    },
  ];
}

function printReport(state, checks) {
  const {
    screen,
    rest,
    restBounds,
    didShow,
    bounds,
    keyboardIme,
    closed,
    resume,
    resumeIme,
  } = state;
  console.log(
    `screen      ${screen.w}x${screen.h} physical px, dpr=${didShow.dpr}`,
  );
  console.log(
    `rest        vv=${rest.vv} inner=${rest.inner} kb=${rest.kb} webview=[${restBounds.left},${restBounds.top}][${restBounds.right},${restBounds.bottom}] (${rest.tag})`,
  );
  console.log(
    `keyboard    vv=${didShow.vv} inner=${didShow.inner} kb=${didShow.kb} ime=${keyboardIme} webview=[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]`,
  );
  console.log(
    `closed      vv=${closed.vv} inner=${closed.inner} kb=${closed.kb} (${closed.tag})`,
  );
  console.log(
    `resume      vv=${resume.vv} inner=${resume.inner} kb=${resume.kb} ime=${resumeIme} (${resume.tag})`,
  );
  for (const check of checks) {
    console.log(`${check.id} ${check.pass ? "PASS" : "FAIL"}  ${check.detail}`);
  }
}

function printArtifacts() {
  const names = existsSync(ARTIFACT_DIR)
    ? readdirSync(ARTIFACT_DIR).filter((name) => name.endsWith(".png"))
    : [];
  const paths = names.map((name) => join(ARTIFACT_DIR, name));
  console.log(
    paths.length
      ? `artifacts: ${paths.join(", ")}`
      : "artifacts: none captured",
  );
}

async function main() {
  const state = await runScenario();
  const checks = assertGeometry(state);
  printReport(state, checks);
  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    for (const check of failed) {
      console.error(
        `::error::native-shell keyboard guard assertion ${check.id} failed — ${check.label}: ${check.detail}`,
      );
    }
    process.exitCode = 1;
  }
}

process.on("exit", printArtifacts);

main().catch((error) => {
  console.error(`::error::native-shell keyboard guard failed: ${error.message}`);
  process.exitCode = 1;
});
