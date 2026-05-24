# PixQrModal a11y refactor — 2026-05-16

Replace the hand-rolled overlay in `src/components/settlement/pix-qr-modal.tsx` with the existing `Dialog` primitive (`src/components/ui/dialog.tsx`, wraps `@base-ui/react/dialog`) to fix the P0 S10 audit finding: missing `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, Escape, and return-focus.

## 1. JSX boundary

Stays outside `<DialogContent>` (component body, unchanged):
- All `useRef`, `useState`, `useCallback`, `useEffect` blocks (`pix-qr-modal.tsx:50-202`).
- Handlers: `handleSliderChange`, `handleCopy`, `handlePayment`, `handleSuccessClose` (`:204-239`).
- The `if (!open) return null;` guard (`:261`) is deleted — `Dialog` handles mount/unmount via `open`.

Moves inside `<DialogContent>`: everything currently rendered between `:263-518` minus the outer `<AnimatePresence>` and the two `<motion.div>` wrappers that implement the backdrop + slide-up panel (`:264-282`, `:516-517`). Inner `AnimatePresence mode="wait"` for the success/form swap (`:286-515`) is kept — that animation is content-level, not chrome.

The drag-to-dismiss affordance (`:272-282`, `handleDragEnd` at `:250-259`, the grab pill at `:284`) is removed: it's coupled to the Framer Motion panel and is replaced by Escape + backdrop click that the Dialog provides.

## 2. API change and call sites

Internally bridge:
```
<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} modal>
```
The public `PixQrModalProps` (`:21-34`) stays as `open` + `onClose`. No caller edits needed. Call sites to leave untouched:
- `/home/prei/pixwise/src/components/dashboard/dashboard-content.tsx:442`
- `/home/prei/pixwise/src/components/group/group-settlement-view.tsx:433`
- `/home/prei/pixwise/src/components/chat/conversation-pay-button.tsx:231`
- `/home/prei/pixwise/src/app/app/bill/[id]/page.tsx:1072`
- `/home/prei/pixwise/src/app/demo/page.tsx:551`

## 3. Title / description

- `<DialogTitle>` wraps the existing `<h2>` text at `:359-361` ("Pagar via Pix" / "Cobrar via Pix"). Use the primitive's `className` slot to preserve the current `text-lg font-bold` styling.
- `<DialogDescription>` wraps the recipient line at `:362-365` ("para/de <name>"). This satisfies `aria-describedby` for screen readers and is a natural sentence following the title.
- In the success branch (`showSuccess`), render a visually-hidden `<DialogTitle>` ("Pagamento registrado") so the dialog always has an accessible name regardless of branch. The visible `<h2>` at `:300-307` stays for styling.

## 4. Close button

Delete the bottom "Fechar" Button at `:334-341` only if it duplicates the primitive's X — keep it, since it's part of the success-state CTA layout (centered, post-confetti). Render `<DialogContent showCloseButton={false}>` so the primitive's top-right X (`dialog.tsx:62-77`) is suppressed, since the modal already self-dismisses via the success Button and backdrop click. The "Fechar" button handler stays `handleSuccessClose` (preserves `onSettlementComplete` callback timing).

## 5. Animation / overlay

Default to option (a): accept the Dialog's fade + zoom-in animation from `dialog.tsx:34, :56`. Reasons: the slide-up was tied to drag-to-dismiss (also being removed), and `@base-ui` animations are CSS-driven (`data-open`/`data-closed`) which keeps SSR clean and removes Framer overhead on the chrome layer. The mobile bottom-sheet feel is a nice-to-have, not load-bearing — the modal is reachable from desktop and mobile alike. Override `DialogContent` className to widen `max-w-sm` to `max-w-md` to match the current width (`:282`).

## 6. Preserved behavior

`ConfettiBurst`, `react-hot-toast` calls, `QRCode.toCanvas`, the 500ms debounce timer + `AbortController` (`:124-143`), and the auto-close `setTimeout` (`:220-222`) all live in component state/effects outside the JSX subtree being swapped — unaffected. The range slider (`:376-387`) and snap-tick rendering (`:388-400`) move verbatim into `DialogContent`.

## 7. Tests

Existing `src/components/settlement/pix-qr-modal.test.tsx` (8 tests): the framer-motion mock at `:5-15` becomes mostly unused (only `<ConfettiBurst>` still uses motion). Keep it — harmless. All 8 existing tests should pass unchanged because they query by role/text, not by overlay structure.

Add to the same file:
- Escape closes: `fireEvent.keyDown(document.body, { key: "Escape" })` → expect `onClose` called.
- `role="dialog"` and `aria-modal="true"` present on rendered dialog element.
- Focus moves into dialog on mount (assert `document.activeElement` is inside `getByRole("dialog")`); on close, focus returns to a trigger button rendered in the test harness.
- Slider drag still works inside the focus trap (`fireEvent.change` on `getByRole("slider")` — existing test at `:187` already covers this; add an assertion that the slider receives focus via Tab without the trap blocking it).

No change needed to `group-settlement-view.test.tsx` or `conversation-pay-button.test.tsx` — they mock `PixQrModal`.

## 8. Risks / decisions

- `@base-ui/react/dialog` defaults to modal mode (focus trap + scroll lock); `dialog.tsx:10-12` doesn't override this. Confirmed sufficient.
- Range slider: `@base-ui` focus trap uses `tabindex` cycling, not pointer interception. Pointer drag on the `<input type="range">` is unaffected. The existing `onPointerDown={(e) => e.stopPropagation()}` at `:383` was needed only to defeat the Framer drag handler — it can be removed once the outer drag is gone.
- Capacitor Android hardware back: `src/lib/capacitor/index.ts:16-22` calls `window.history.back()` unconditionally. With the new Dialog, back will pop history instead of closing the modal. Out of scope for this PR — flag in the PR description as a follow-up (the back handler needs to first check for an open Base UI dialog and dispatch Escape to it).
- The shared dynamic-loading-fallbacks test (`src/components/shared/dynamic-loading-fallbacks.test.tsx`) only checks that the dynamic import is wired with a loading skeleton — unaffected.

## 9. Verification

```
npm test -- pix-qr-modal
npm test -- group-settlement-view conversation-pay-button dynamic-loading-fallbacks
npx tsc --noEmit
npm run lint
```
