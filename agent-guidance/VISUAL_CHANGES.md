# Visual changes

A visual change is done when the browser proves it, not when the build passes. Every change that touches rendering ships with screenshot evidence at the viewports that matter and zero console errors. This guide is the workflow that produced verified mobile-polish work in the 2026-09-09 design session; follow it for any UI change.

## Standard of proof

"Verified" means all of the following, in a real browser:

- Every affected route renders at 360, 390, and 430 px width with no horizontal overflow.
- No `console.error` or `pageerror` fired while exercising the change.
- Screenshots exist for the changed states, captured after fonts and images settle.
- Interaction edge cases around the change (sticky controls, focus states, reduced motion) behave at short viewports too.

A passing build and clean lint say nothing about any of this. Pixel and overflow bugs only appear in the rendered page.

## Serve the surface

Start servers as named hub processes, never as background shell commands. Ready conditions are required; process creation is not readiness.

```txt
hub start  name=web  application=npm  args=["run","dev"]  ready={log:"Ready",port:3000}
```

For static prototypes or exported HTML, bind a directory:

```txt
python3 -m http.server 8766 --bind 127.0.0.1 --directory <prototype-dir>
```

## Open named tabs

```js
const tab = await browser.open({ name: "mobile", url: "http://localhost:3000/app", viewport: { width: 390, height: 844 } });
```

- Give every tab a `name` tied to the surface (`mobile`, `settlement`, `gallery`) and reuse it; anonymous tabs multiply and leak.
- Pass `persist: true` only when a flow spans multiple turns (login, seeding).
- Close tabs with `browser.close` when the surface is done. Idle tabs stay alive and consume resources.

Use `observe()` for structure, `evaluate()` for DOM facts, `screenshot()` for visual proof. One screenshot beats a paragraph of claimed outcomes.

## Authenticate

Never drive the Google OAuth UI. Use the dev login route (README: "Programmatic login (dev only)"):

```js
await tab.run(async ({ page }) => {
  await page.evaluate(async () => {
    await fetch("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-login-secret": "<DEV_LOGIN_SECRET from .env.local>" },
      body: JSON.stringify({ email: "tiago@test.dividimos.local", name: "Tiago Rocha", handle: "tiago" }),
    });
  });
});
await tab.goto("http://localhost:3000/app");
```

Seed every participant the flow needs the same way before opening group screens. Emails must be `@test.dividimos.local`.

## Sweep routes × viewports

The core verification loop. One tab, every route, three phone sizes, overflow and console checks per route:

```js
display(await tab.run(async ({ page }) => {
  const routes = ["home", "groups", "bill-single", "bill-itemized", "settlement"];
  const sizes = [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
  const results = [];
  for (const size of sizes) {
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    for (const route of routes) {
      const errors = [];
      const onConsole = (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); };
      page.on("console", onConsole);
      await page.goto(`http://localhost:3000/app/${route}`, { waitUntil: "networkidle0", timeout: 90000 });
      const info = await page.evaluate(async () => {
        await document.fonts.ready;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          heading: document.querySelector("h1")?.textContent,
        };
      });
      page.off("console", onConsole);
      results.push({ size: size.width, route, ...info, errors });
    }
  }
  return results;
}, { timeout: 600 }));
```

Report the result as a route × width table. `deviceScaleFactor: 1` for sweeps (CSS pixels are what overflow); `2` only for final captures.

## Deterministic screenshots

Capture only after the page settles, or the screenshot lies:

```js
await page.bringToFront();
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode()));
  document.activeElement?.blur();               // no stray focus rings
  document.querySelector("nextjs-portal")?.remove(); // strip dev overlay
  await new Promise((r) => setTimeout(r, 300)); // let animations finish
});
await page.screenshot({ path: "/tmp/shot.webp", type: "webp", quality: 90 });
```

- Finite animations only: if a state animates forever, either the animation must be bounded or wait past it before capturing.
- Focus-dependent states (hover, focus-visible, autofill) need CDP focus emulation when the tab is not the foreground tab:
  `const session = await page.createCDPSession(); await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });`

## Interaction checks beyond pixels

- Sticky controls and footers: re-test at a short viewport (e.g. 390 × 450), scroll the first and last row into view, and assert the edited row stays clear of the sticky chrome.
- Reduced motion: `await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])` — assert the UI is still usable and animations stop.
- Clipboard flows: `await page.browserContext().overridePermissions(origin, ["clipboard-read", "clipboard-write"])` before asserting copied text.
- Client state: after actions, assert `localStorage`/store values, not just the screenshot.

## Evidence in the PR

- Save screenshots outside the repo (`/tmp`), attach via secret gist when the PR needs images (see CLAUDE.md PR-image rules). Never commit them.
- The PR body states what was verified: routes, widths, console-clean result, and the interaction edge cases exercised. Link the screenshot set.
- If a check could not run (no dev server surface, terminal-only change), say so explicitly instead of implying visual verification.

## Anti-patterns

- Declaring a UI fix done from code reading or a passing build.
- Screenshotting a single viewport and calling it responsive.
- Capturing mid-animation or before `document.fonts.ready`.
- Ignoring `console.error` because the page "looks right".
- Driving OAuth by hand instead of `/api/dev/login`.
- Leaving browser tabs open after the turn.
