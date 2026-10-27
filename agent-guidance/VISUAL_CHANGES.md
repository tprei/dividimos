# Visual changes

A visual change is done when the browser proves it, not when the build passes. This guide has two halves that always ship together: an interaction design contract for what motion and surfaces may express, and a real-browser workflow that proves the result. Every change that touches rendering follows both.

The design input for the contract is Fluid Functionalism (https://www.fluidfunctionalism.com/docs). Use its philosophy; do not install its library or registry. When a PR adopts or rejects a specific recommendation, link the source page and state what was adopted and what was rejected, with the reason.

## Design contract

### Motion means state

Motion is a statement about a state or a relationship, never decoration and never a delay. Every animation added to the app gets a row in the state matrix — in the PR description or next to the component — before it is written:

| State / relationship | Communicates | Motion | Under reduced motion |
|---|---|---|---|
| `pending` | action accepted, in flight | ongoing indicator (spinner, disabled control); may run indefinitely | indicator remains perceivable |
| `confirmed` | the ledger/RPC registered the change (our fact, not the bank's) | finite settle from a shared preset | end state lands immediately |
| `reversed` | mutation failed and rolled back | finite transition back to the prior state | end state lands immediately |
| `entered` / `exited` | surface's relationship to its parent | shared enter/exit variants (`popIn`, `fade`) | `fade` |
| `pressed` | direct manipulation feedback | `tapScale` | none; the state change is instant |

Rules that follow from the matrix:

- Motion never delays an action: the tap lands immediately; the animation describes the change that already happened.
- Motion never claims what the system has not confirmed. An optimistic store patch alone is `pending`, not `confirmed`. When the recording RPC acknowledges, ledger-registration success ("Pagamento registrado") may animate as `confirmed`. Claiming bank/Pix confirmation from an optimistic patch or from our recording RPC acknowledgement is forbidden — only the real confirmation path may say the bank confirmed.
- The ongoing pending indicator is the only animation allowed to run forever. Everything else must settle.
- Under `prefers-reduced-motion`, the state is still communicated: movement drops (`MotionProvider` sets `reducedMotion="user"`), the final state is reached and perceivable. Verify this per change; do not assume every animation obeys the media query.

### One motion vocabulary

- The shared presets in `src/lib/animations.ts` (`springs`, `popIn`, `fade`, `tapScale`) and `MotionProvider` are the source of truth. Import them; do not restate values.
- Do not invent per-component spring constants. A new constant needs a written physical justification in the PR, and if it recurs it moves into `animations.ts`.
- Prefer few roles over many effects: a small set of text and control roles, money and counters in stable digits (`tabular-nums`, so digit changes never reflow), one consistent focus ring, explicit activation for every action.
- Keep Dividimos's own decisions: PT-BR copy, 16px editable text on mobile, 44px touch targets, existing domain colors and shadcn/Base UI tokens. A foreign aesthetic does not override the product.

### Rejected patterns

- Hover-only actions. Every pointer behavior has a touch and a keyboard path.
- Proximity or gap activation for financial actions. A miss must never trigger a ledger change; financial controls keep explicit activation with separated hit areas.
- Eight-level surface infrastructure. The existing token set stays; an elevation ladder is infrastructure without a need.
- Variable-font-weight motion without proof of no reflow. Animating weight shifts layout; if a change needs it, the capture must prove geometry stays stable.
- Wholesale registry or library installs. Adopt specific patterns from a source; never add a registry, theme pack, or animation library in bulk.

## Real-browser verification

### Standard of proof

"Verified" means all of the following, in a real browser:

- Every affected route renders at 360, 390, and 430 px; at 390 × 450 when anything is sticky or anchored; and at the desktop breakpoints the change's `md:`/`lg:` classes actually respond at.
- No `console.error` and no `pageerror`, collected during navigation and during the actions that exercise the change — not only on load.
- Light and dark themes both captured; normal and reduced motion both exercised when anything moves.
- Screenshots exist for the changed states, captured after fonts, images, state, and geometry settle.
- Client-state assertions observe rendered state: act, reload while online, confirm what the ledger registered. The ledger persists to IndexedDB via `src/lib/idb-storage.ts`; theme and tour preferences legitimately live in `localStorage`. An online reload proves the confirmed UI/server state, not storage persistence — a persistence claim needs a storage inspection or an offline reload.

### Serve the surface

Start servers as named hub processes, never as background shell commands. Ready conditions are required; process creation is not readiness.

```txt
hub start  name=web  application=npm  args=["run","dev"]  ready={log:"Ready",port:3000}
```

For static prototypes or exported HTML, bind a directory:

```txt
python3 -m http.server 8766 --bind 127.0.0.1 --directory <prototype-dir>
```

### Open named tabs

```js
const tab = await browser.open({ name: "mobile", url: "http://localhost:3000/app", viewport: { width: 390, height: 844 } });
```

- Give every tab a `name` tied to the surface (`mobile`, `settlement`, `gallery`) and reuse it; anonymous tabs multiply and leak.
- Pass `persist: true` only when a flow spans multiple turns (login, seeding).
- Close tabs with `browser.close` when the surface is done. Idle tabs stay alive and consume resources.

Use `observe()` for structure, `evaluate()` for DOM facts, `screenshot()` for visual proof.

### Authenticate

Never drive the Google OAuth UI. Use the dev login route (README: "Programmatic login (dev only)"):

```js
await tab.run(async ({ page }, secret) => {
  await page.evaluate(async (s) => {
    const res = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-login-secret": s },
      body: JSON.stringify({ email: "tiago@test.dividimos.local", name: "Tiago Rocha", handle: "tiago" }),
    });
    if (!res.ok) throw new Error(`dev login failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (body?.success !== true) throw new Error(`dev login rejected: ${JSON.stringify(body)}`);
  }, secret);
}, { args: [process.env.DEV_LOGIN_SECRET] });
await tab.goto("http://localhost:3000/app");
```

Seed every participant the flow needs the same way before opening group screens. Emails must be `@test.dividimos.local`. The dev secret stays in the environment; it never appears in captures, gists, or PR text. The same `DEV_LOGIN_SECRET` must be supplied to the dev server's environment and to the runner that executes `tab.run` — a `tab.run` function does not capture the caller's scope or inherit later env changes, so the snippet reads the variable in the runner and passes it through `args`; a mismatch fails loudly here instead of leaving an anonymous session behind. Open the app on `localhost`: a `127.0.0.1` origin can fall outside Next's `allowedDevOrigins` and break dev routes.

### Error collection and readiness

Two helpers used by everything below. Error collection spans navigation and actions, and always detaches in `finally`:

```js
const watchErrors = (page) => {
  const errors = [];
  const onConsole = (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); };
  const onPageError = (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`);
  return {
    errors,
    attach: () => { page.on("console", onConsole); page.on("pageerror", onPageError); },
    detach: () => { page.off("console", onConsole); page.off("pageerror", onPageError); },
  };
};
```

Readiness is a caller-supplied predicate over actual state. Never `networkidle0`: the app holds realtime connections, so the wait either never fires or fires at the wrong moment.

```js
const ready = (page, isReady) => page.waitForFunction(isReady, { timeout: 15000, polling: 250 });
```

Write the predicate against the real surface (the route's `h1`, a list row's text, the wizard step heading), never against a test ID you wish existed. For route-specific readiness, `isReady(route, width)` returns that route's page-side predicate — plain DOM facts, still no invented test IDs.

### Sweep routes × viewports

```js
const sweep = async ({ page, origin, routes, sizes, isReady, act }) => {
  const results = [];
  for (const size of sizes) {
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    for (const route of routes) {
      const watch = watchErrors(page);
      watch.attach();
      try {
        await page.goto(`${origin}/${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
        if (act) await act(page, route, size.width);
        await ready(page, isReady(route, size.width));
        const info = await page.evaluate(async () => {
          await document.fonts.ready;
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            heading: document.querySelector("h1")?.textContent,
          };
        });
        results.push({ width: size.width, route, ...info, errors: [...watch.errors] });
      } finally {
        watch.detach();
      }
    }
  }
  return results;
};
```

```js
const results = await sweep({
  page,
  origin: "http://localhost:3000/app",
  routes: ["", "groups", "bills", "charges", "conversations", "activity", "profile", "settings", "bill/new"],
  sizes: [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }],
  isReady: (route) => (route === "bill/new"
    ? () => document.querySelectorAll("input").length > 0
    : () => !!document.querySelector("h1")),
  act: async (page) => {
    await page.keyboard.press("Tab");
  },
});
const failures = results.filter((r) => r.overflow || r.errors.length > 0 || !r.heading);
if (failures.length > 0) throw new Error(`sweep failures: ${JSON.stringify(failures)}`);
```

`act` exercises the change — taps the control, advances the wizard step, opens the popover — using selectors from the actual component. The order matters: load, act, then wait for the post-action state and measure overflow, because measuring before acting hides layout shifts the change itself causes. Because the listeners are still attached, errors raised during those actions land in the same result. The caller check after the sweep is mandatory: overflow, a collected `console.error`/`pageerror`, or a missing heading is a failure that stops the run — these are not advisory fields. A timeout from `ready` or a navigation failure throws out of the sweep on its own. Report as a route × width table. `deviceScaleFactor: 1` for sweeps (CSS pixels are what overflow); `2` only for final captures.

The coverage matrix for a rendering change: 360/390/430, plus 390 × 450 when anything is sticky or anchored, plus the affected desktop widths, in both themes, plus a reduced-motion pass (`await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])`) when anything moves.

### Deterministic screenshots

A screenshot taken before the page settles is a lie. No fixed sleeps; wait for facts:

```js
const settledShot = async ({ page, path, isReady, targets, timeoutMs = 15000 }) => {
  if (!targets?.length) throw new Error("settledShot needs explicit target selectors");
  await page.bringToFront();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((img) => img.src && img.offsetWidth > 0)
        .map((img) => img.decode()),
    );
  });
  await ready(page, isReady);
  await page.evaluate(({ selectors, timeoutMs }) => new Promise((resolve, reject) => {
    const read = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}:${s.opacity}:${s.transform}`;
    };
    const els = selectors.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`capture target not found: ${sel}`);
      return el;
    });
    const started = performance.now();
    let last = els.map(read).join("|");
    let stable = 0;
    const tick = () => {
      const now = els.map(read).join("|");
      stable = now === last ? stable + 1 : 0;
      last = now;
      if (stable >= 12) resolve();
      else if (performance.now() - started > timeoutMs) reject(new Error(`targets never settled: ${selectors.join(", ")}`));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { selectors: targets, timeoutMs });
  await page.screenshot({ path, type: "png" });
};
```

- `targets` names every surface whose motion must have finished — the entering card, the sliding sheet, the settling row. Body or a distant parent hides child movement; there is no default and no silent fallback: a selector that matches nothing fails the capture.
- The check samples every target's geometry, opacity, and transform and requires twelve consecutive unchanged frames, bounded by `timeoutMs` — a target that never settles fails the evidence instead of capturing a lie. No fixed sleeps. `document.getAnimations()` alone is not a settle check: Framer Motion drives springs from JavaScript, and they do not all appear there. The caller's `isReady` predicate carries the actual state; the target sampling carries the transition.
- A pending spinner is excluded intentionally — it is an allowed ongoing indicator and never settles. List the surfaces that must finish, not the indicator; when the state under capture is `pending`, capture it deliberately and label it pending in the evidence.
- A visible image that fails to decode fails the capture; decode errors propagate. Output is PNG, matching the evidence rule below.
- Preserve focus by default. Do not blur `document.activeElement` to sanitize a capture; if a stray ring appears, fix the setup that focused it. Focus-dependent states (focus-visible, autofill) need CDP focus emulation when the tab is not the foreground tab:
  `const session = await page.createCDPSession(); await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });`
- Never remove the dev overlay (`nextjs-portal`) or any error surface to make a capture look clean. An error visible in the overlay is a failed check. Capture cleanly around the dev indicator or configure it via `devIndicators` in `next.config.ts` — removal hides evidence and changes nothing.

### Motion and reversal evidence

A change to motion, or to reversal behavior, ships with a still pair and a short recording. The browser records real-time video with true timestamps; wrap the interaction between start and stop:

```js
const recordInteraction = async (tab, path, act) => {
  await tab.recordStart(path);
  try {
    await act(tab);
  } finally {
    await tab.recordStop();
  }
  return path;
};
```

```js
await recordInteraction(tab, "/tmp/reversal.mp4", async (t) => {
  await t.click("<the actual control selector from the component>");
});
```

`.mp4` (H.264; `.webm` is available too) plays at true speed, so a spring's character — bounce, overshoot, reversal — is reviewable exactly as it happened; the still proves the end state. Never reconstruct evidence from individually captured frames: their timing is not real.

### Interaction checks beyond pixels

- Keyboard: tab through the changed surface; one consistent visible focus ring; Enter and Space activate what the pointer activates. When the keyboard is the subject, keep the field focused for the capture.
- Pointer/touch parity: explicit, single-tap activation everywhere; no behavior that only exists under hover.
- Reduced motion preserves state: with `prefers-reduced-motion: reduce` the flow still completes and the final state is visible — movement removed, meaning kept.
- Nested overlays: capture dialog-over-card and popover-over-card in light and dark, and confirm the two surfaces are distinguishable and text contrasts. Do not assume the shared dark fill separates on its own.
- Sticky controls and anchored surfaces: re-test at 390 × 450, scroll the first and last row into view, assert the row stays clear of sticky chrome; confirm the popover stays inside the visual viewport at 360 px and dismisses on outside tap without activating the control underneath.
- Clipboard flows: `await page.browserContext().overridePermissions(origin, ["clipboard-read", "clipboard-write"])` before asserting copied text.
- Real-device claims only: a resized browser viewport is not a keyboard. IME behavior (accessory bar, `visualViewport` shifts) and haptics need a real device; emulation proves layout math only.
- Financial feedback: assert what the ledger actually confirmed. Pending reads as pending; "Pagamento registrado" may show on the recording RPC's ack; bank/Pix confirmation comes only from the real confirmation path.

## Evidence in the PR

- Capture "before" from the PR's parent branch and "after" from the PR head, with the same seeded data, theme, viewport, and capture conditions. Original bug-report screenshots are context, not a controlled before. (`agent-guidance/writing/STACKED_DIFFS.md`, "Review Rules".)
- Save captures outside the repo (`/tmp`). Never commit screenshots.
- Publish one secret gist per PR with the PNGs as raw files: create the gist without `--public`, then `git clone https://gist.github.com/<id>.git`, copy the PNGs and recordings in, commit, and push. Do not publish an HTML gallery of base64 data URLs — the images must render inline in the PR body.
- The PR body carries a Before/After markdown table with `![alt](url)` for each viewport and theme, using `https://gist.githubusercontent.com/<user>/<id>/raw/<file>.png` URLs, plus the verification summary: routes, widths, themes, motion modes, console/pageerror-clean result, and the interaction cases exercised. Link the gist and the recordings.
- Before finishing, confirm the images actually render in the PR body. If a check could not run, say so explicitly instead of implying visual verification.
- Evidence contains no secrets (never a `DEV_LOGIN_SECRET` value) and no personal accounts — only `@test.dividimos.local` seeds.
- When the change applies or rejects Fluid Functionalism guidance, link the source page with the adopt/reject rationale.

## Anti-patterns

- Declaring a UI fix done from code reading or a passing build.
- Screenshotting a single viewport and calling it responsive.
- Capturing mid-transition, before `document.fonts.ready`, or after a fixed `setTimeout` instead of a settle check.
- Collecting `console.error` but never `pageerror`, or detaching listeners before the actions run.
- Waiting on `networkidle0` in a realtime app.
- Removing the dev overlay to make a capture look clean.
- Swallowing a decode, settle, or capture error to force the evidence through.
- Linking a gallery page instead of rendering the images inline in the PR body.
- Claiming bank/Pix confirmation from an optimistic patch or from our recording RPC acknowledgement.
- Inventing spring constants, surface levels, or font-weight motion per component.
- Driving OAuth by hand instead of `/api/dev/login`.
- Leaving browser tabs open after the turn.
