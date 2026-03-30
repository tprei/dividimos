# Pagajaja rebrand plan

**Date:** 2026-03-30
**Status:** Draft -- awaiting approval before execution
**Scope:** Full rebrand from Pixwise to Pagajaja across naming, color palette, typography, mascot system, microcopy, and Pix compliance

---

## Table of contents

1. [Inventory of changes](#1-inventory-of-changes)
2. [Workstream breakdown](#2-workstream-breakdown)
3. [Workstream 1 -- Design tokens and CSS](#workstream-1--design-tokens-and-css)
4. [Workstream 2 -- Typography](#workstream-2--typography)
5. [Workstream 3 -- Brand rename (Pixwise to Pagajaja)](#workstream-3--brand-rename-pixwise-to-pagajaja)
6. [Workstream 4 -- Microcopy overhaul](#workstream-4--microcopy-overhaul)
7. [Workstream 5 -- Mascot system](#workstream-5--mascot-system)
8. [Workstream 6 -- PWA assets and metadata](#workstream-6--pwa-assets-and-metadata)
9. [Workstream 7 -- Pix brand compliance](#workstream-7--pix-brand-compliance)
10. [Workstream 8 -- UI component restyling](#workstream-8--ui-component-restyling)
11. [Dependency graph](#3-dependency-graph)
12. [Validation checklist](#4-validation-checklist)
13. [Risk register](#5-risk-register)
14. [Open questions](#6-open-questions)

---

## 1. Inventory of changes

### 1.1 Files referencing "Pixwise" or "pixwise" (47 locations across 33 files)

**Source code (user-facing):**
- `src/app/layout.tsx` -- metadata title, template, authors
- `src/app/manifest.ts` -- PWA id, name, short_name
- `src/app/page.tsx` -- footer copyright
- `src/components/shared/logo.tsx` -- brand text rendering
- `src/components/landing/features-section.tsx` -- "Por que Pixwise?" heading
- `src/components/bill/guest-claim-share-modal.tsx` -- share text and navigator.share title
- `src/components/pwa/notification-prompt.tsx` -- session storage key
- `src/stores/bill-store.ts` -- JSDoc comments (2 locations)
- `src/app/app/bill/new/page.tsx` -- guest label "sem conta no Pixwise"
- `public/sw.js` -- cache names, push notification title (3 locations)
- `public/offline.html` -- page title

**Source code (internal/infra):**
- `src/app/auth/phone-actions.ts` -- `@phone.pixwise.local` email domain
- `src/app/auth/onboard/page.tsx` -- phone auth detection `@phone.pixwise.local`
- `src/app/api/dev/login/route.ts` -- dev login comments and test email domain
- `src/lib/push/web-push.ts` -- VAPID subject `contato@pixwise.app`
- `src/lib/claim-qr.ts` -- no direct reference (domain is runtime)

**Test files:**
- `src/app/manifest.test.ts` -- expected strings
- `src/lib/claim-qr.test.ts` -- `pixwise.app` in test URLs
- `src/lib/sw-push.test.ts` -- `pixwise.app` in test URLs, "Pixwise" in expected notification title
- `src/lib/sw.test.ts` -- `pixwise.app` in test URLs, `pixwise-static-v1`/`pixwise-runtime-v1` cache names
- `src/components/pwa/notification-prompt.test.tsx` -- session key assertion
- `src/lib/push/web-push.test.ts` -- VAPID subject
- `e2e/seed-helper.ts` -- `@test.pixwise.local`
- `src/test/integration-helpers.ts` -- `@test.pixwise.local`

**Config and scripts:**
- `package.json` -- `"name": "pixwise"`
- `package-lock.json` -- `"name": "pixwise"` (2 locations)
- `supabase/config.toml` -- `project_id = "pixwise-local"`
- `supabase/seed.sql` -- `@test.pixwise.local` emails (6 references)
- `scripts/dev-setup.sh` -- header comment and seed user note
- `scripts/generate-icons.mjs` -- "Pixwise" text in screenshot SVG
- `playwright.config.ts` -- header comment

**Documentation:**
- `README.md` -- title, description, git clone URL
- `CLAUDE.md` -- project description, seed user references
- `TESTING.md` -- opening sentence
- `docs/production-readiness.md` -- references throughout
- `docs/2025-03-30-twilio-verify-consolidation.md` -- 2 references

### 1.2 Design token files

- `src/app/globals.css` -- all CSS custom properties (`:root` and `.dark`), gradient utilities, range input styling, glass utilities
- `src/app/layout.tsx` -- `themeColor` viewport meta values
- `src/app/manifest.ts` -- `background_color`, `theme_color`
- `public/offline.html` -- hardcoded `#0d9488` teal and `#f5fdfc` background

### 1.3 Font configuration

- `src/app/layout.tsx` -- `Inter` (body) and `Geist_Mono` (mono) from `next/font/google`
- `src/app/globals.css` -- `--font-sans`, `--font-mono`, `--font-heading` custom properties

### 1.4 SVG and icon assets

- `public/icon.svg` -- teal receipt icon with `#0d9488` fill
- `public/icon-maskable.svg` -- same, with safe-zone scaling
- `public/icon-192.png`, `public/icon-512.png` -- generated from SVG
- `public/icon-maskable-192.png`, `public/icon-maskable-512.png` -- generated from SVG
- `public/screenshots/narrow.png` -- generated screenshot with "Pixwise" text
- `scripts/generate-icons.mjs` -- generates all PNG icons from SVGs

### 1.5 User-facing Portuguese text (microcopy locations)

All user-facing text is in pt-BR. Key locations:

| Component/page | Text types |
|---|---|
| `src/components/landing/hero-content.tsx` | Tagline, hero heading, subtext, CTA labels |
| `src/components/landing/features-section.tsx` | Feature titles, descriptions, section heading |
| `src/components/landing/how-it-works-section.tsx` | Step titles, descriptions |
| `src/components/landing/cta-section.tsx` | CTA heading, subtext, button label |
| `src/app/auth/page.tsx` | Auth form labels, button text, legal notice |
| `src/app/auth/onboard/page.tsx` | Onboarding form labels, validation messages, Pix step text |
| `src/components/app-shell.tsx` | Nav labels (Inicio, Contas, Nova, Grupos, Perfil) |
| `src/components/dashboard/dashboard-content.tsx` | Greeting, balance labels, tab labels, empty states |
| `src/components/dashboard/debt-card.tsx` | "Voce deve"/"Voce recebe", button labels |
| `src/components/bills/bills-list-content.tsx` | Status labels, filter labels, search placeholder, delete dialog |
| `src/components/bill/bill-type-selector.tsx` | Type names, subtitles, example lists |
| `src/components/bill/add-item-form.tsx` | Form labels |
| `src/components/bill/item-card.tsx` | Item card text |
| `src/components/bill/single-amount-step.tsx` | Split method labels |
| `src/components/bill/payer-step.tsx` | Payer selection text |
| `src/components/bill/bill-summary.tsx` | Summary labels |
| `src/components/bill/guest-claim-share-modal.tsx` | Share text, modal labels |
| `src/components/bill/group-selector.tsx` | Group selection text |
| `src/components/groups/groups-list-content.tsx` | Page heading, member counts, invite labels, empty state |
| `src/app/app/groups/[id]/page.tsx` | Group detail labels, member management, expense status labels |
| `src/app/app/profile/page.tsx` | Section headings, Pix key labels, preference labels, sign out |
| `src/app/app/settings/page.tsx` | 2FA labels, notification labels |
| `src/components/settlement/pix-qr-modal.tsx` | Modal labels, payment status, copy text |
| `src/components/settlement/charge-explanation.tsx` | Breakdown labels |
| `src/components/settlement/simplification-toggle.tsx` | Toggle labels |
| `src/components/shared/empty-state.tsx` | Template (receives props) |
| `src/components/pwa/install-prompt.tsx` | iOS Safari instructions, install button |
| `src/components/pwa/notification-prompt.tsx` | Notification opt-in text |
| `src/app/claim/[token]/page.tsx` | Claim page labels |
| `public/offline.html` | Offline page heading, message, button |
| `src/components/error-boundary.tsx` | Error titles, messages, retry button |
| `src/app/demo/page.tsx` | Demo page text |

---

## 2. Workstream breakdown

Eight parallel workstreams organized by dependency. Workstreams 1-2 are foundational; the rest can run in parallel after them.

```
WS1 (Design tokens)  ─┐
WS2 (Typography)      ─┼─> WS3 (Brand rename)     ─> WS6 (PWA assets)
                       │   WS4 (Microcopy)
                       │   WS5 (Mascot system)
                       │   WS7 (Pix compliance)
                       └─> WS8 (UI component restyling)
```

**Critical path:** WS1 -> WS8 (component restyling depends on token values being finalized)
**Parallelizable after WS1+WS2:** WS3, WS4, WS5, WS7 are fully independent of each other

---

## Workstream 1 -- Design tokens and CSS

**Agent model:** sonnet (implementation)
**Estimated scope:** 1 file primary, 3 files secondary

### Target files

1. **`src/app/globals.css`** -- primary. Replace all `:root` and `.dark` CSS custom property values. Update gradient utilities and hardcoded oklch values in range input thumbs, glass utilities, etc.
2. **`src/app/layout.tsx`** -- `themeColor` values in viewport export
3. **`src/app/manifest.ts`** -- `background_color` and `theme_color`
4. **`public/offline.html`** -- hardcoded colors in inline `<style>`

### Color mapping

Current oklch values need to be replaced with the new Pagajaja palette. The mapping (hex -> oklch conversion required):

| Token | Current (teal-based) | New hex | New purpose |
|---|---|---|---|
| `--primary` | `oklch(0.55 0.15 175)` | `#FEA101` | Vitamin C Orange |
| `--primary` dark | `oklch(0.65 0.17 175)` | `#FEA101` | Same, adjust lightness for dark |
| `--secondary` | `oklch(0.96 0.01 180)` | `#FFC960` | Solar Flare Yellow |
| `--accent` | `oklch(0.93 0.03 175)` | `#16EFE6` | Glitch Turquoise |
| `--success` | `oklch(0.62 0.17 145)` | `#00C853` | Tropical Forest Green |
| `--destructive` | `oklch(0.58 0.22 25)` | `#E7308E` | Acid Berry Magenta |
| `--background` | `oklch(0.985 0.002 180)` | `#F9F9FB` | Soft Canvas |
| `--background` dark | `oklch(0.14 0.015 260)` | `#09243f` | Midnight Server |
| `--ring` | matches primary | `#FEA101` | Match new primary |

**Additional derived tokens to recalculate:**
- `--primary-foreground` -- contrast color on orange (likely near-black or dark brown)
- `--secondary-foreground` -- contrast on yellow
- `--accent-foreground` -- contrast on turquoise
- `--card`, `--popover` -- may stay white/near-white in light, derive from `#09243f` in dark
- `--muted`, `--muted-foreground` -- neutral grays, derive from new background hues
- `--border`, `--input` -- neutral borders
- `--chart-1` through `--chart-5` -- use new palette colors
- `--sidebar-*` -- derive from new background/primary
- `--income`, `--overdue`, `--warning`, `--surface` -- re-harmonize

**Gradient utilities to update:**
- `.gradient-primary` -- currently teal gradient, change to orange
- `.gradient-income` -- currently green, update
- `.gradient-warm` -- currently warm amber, may stay or shift
- `.gradient-mesh` -- background mesh uses primary/secondary tones

**Hardcoded oklch values to find and replace:**
- Range input thumb: `oklch(0.55 0.15 175)` (4 locations in globals.css)
- Glass utility: `oklch(0.19 0.015 260)` references
- Auth page step indicators: hardcoded `oklch(0.55 0.15 175)` in `src/app/auth/page.tsx` (line 389) and `src/app/auth/onboard/page.tsx` (line 465)

### Hex-to-oklch conversions needed

The new palette is specified in hex. Before editing, compute oklch equivalents for each:

```
#FEA101 -> oklch(? ? ?)   -- primary
#FFC960 -> oklch(? ? ?)   -- secondary
#16EFE6 -> oklch(? ? ?)   -- accent
#00C853 -> oklch(? ? ?)   -- success
#E7308E -> oklch(? ? ?)   -- destructive
#F9F9FB -> oklch(? ? ?)   -- background
#09243f -> oklch(? ? ?)   -- dark background
```

Use `oklch()` for all CSS values to maintain consistency with the existing codebase.

### Tasks

1. Convert all hex colors to oklch
2. Replace all 40+ CSS custom property values in `:root` and `.dark` blocks
3. Update gradient utilities (4 gradients)
4. Update range input thumb colors (4 locations)
5. Update glass utility dark mode colors
6. Update `themeColor` in layout.tsx viewport
7. Update `background_color` and `theme_color` in manifest.ts
8. Update inline styles in `public/offline.html`
9. Update hardcoded oklch in auth page step indicators (2 files)

---

## Workstream 2 -- Typography

**Agent model:** sonnet (implementation)
**Estimated scope:** 2 files

### Target files

1. **`src/app/layout.tsx`** -- font imports and CSS variable assignment
2. **`src/app/globals.css`** -- `--font-sans`, `--font-mono`, `--font-heading` declarations

### Changes

**Replace Inter with Nunito:**
```tsx
// Before
import { Inter } from "next/font/google";
const inter = Inter({ variable: "--font-sans", subsets: ["latin"], display: "swap" });

// After
import { Nunito } from "next/font/google";
const nunito = Nunito({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
```

**Add tabular figures font for financial data:**

Option A: Use Nunito with `font-variant-numeric: tabular-nums` (already applied via Tailwind `tabular-nums` class in 10+ components).

Option B: Add a dedicated mono/tabular font and map `--font-heading` or create `--font-tabular`.

Recommendation: Option A is sufficient. Nunito supports tabular figures. The existing `tabular-nums` Tailwind class is already applied on all financial amounts across the codebase. No additional font needed.

**Update CSS variable in globals.css:**
- `--font-heading: var(--font-sans)` stays (Nunito will be the heading font via the same variable)

**Update className in layout.tsx:**
```tsx
// Before
className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
// After
className={`${nunito.variable} ${geistMono.variable} h-full antialiased`}
```

### Tasks

1. Replace Inter import with Nunito in `layout.tsx`
2. Update variable name from `inter` to `nunito` in layout.tsx
3. Verify `tabular-nums` usage across financial display components (already present -- no changes needed)

---

## Workstream 3 -- Brand rename (Pixwise to Pagajaja)

**Agent model:** sonnet (implementation)
**Estimated scope:** 33 files (see inventory 1.1)

This workstream is purely textual find-and-replace. No logic or styling changes.

### Rename categories

**A. User-facing brand name (Pixwise -> Pagajaja):**

| File | Line(s) | Change |
|---|---|---|
| `src/app/layout.tsx` | 22-23, 28 | Title metadata |
| `src/app/manifest.ts` | 5-7 | PWA id, name, short_name |
| `src/app/page.tsx` | 55 | Footer copyright |
| `src/components/shared/logo.tsx` | 23-25 | Logo text rendering |
| `src/components/landing/features-section.tsx` | 40 | "Por que Pixwise?" -> "Por que Pagajaja?" |
| `src/components/bill/guest-claim-share-modal.tsx` | 49-50, 55 | Share text |
| `src/app/app/bill/new/page.tsx` | 1069 | "sem conta no Pixwise" -> "sem conta no Pagajaja" |
| `public/sw.js` | 4-5, 92, 95 | Cache names, notification title |
| `public/offline.html` | 7 | Page title |
| `scripts/generate-icons.mjs` | 35, 38 | Screenshot text |

**B. Internal domain references (pixwise.local, pixwise.app):**

| File | Change |
|---|---|
| `src/app/auth/phone-actions.ts` | `@phone.pixwise.local` -> `@phone.pagajaja.local` |
| `src/app/auth/onboard/page.tsx` | `@phone.pixwise.local` detection |
| `src/app/api/dev/login/route.ts` | `@phone.pixwise.local`, `@test.pixwise.local` references |
| `src/lib/push/web-push.ts` | VAPID subject `contato@pixwise.app` -> `contato@pagajaja.app` |
| `supabase/seed.sql` | `@test.pixwise.local` -> `@test.pagajaja.local` (6 locations) |
| `supabase/config.toml` | `pixwise-local` -> `pagajaja-local` |
| `scripts/dev-setup.sh` | Header comment, seed user note |
| `e2e/seed-helper.ts` | `@test.pixwise.local` |
| `src/test/integration-helpers.ts` | `@test.pixwise.local` |

**C. Session/cache key prefixes:**

| File | Change |
|---|---|
| `src/components/pwa/notification-prompt.tsx` | `pixwise:notification-prompt-dismissed` -> `pagajaja:notification-prompt-dismissed` |
| `public/sw.js` | `pixwise-static-v1` -> `pagajaja-static-v1`, `pixwise-runtime-v1` -> `pagajaja-runtime-v1` |

**D. Package name:**

| File | Change |
|---|---|
| `package.json` | `"name": "pixwise"` -> `"name": "pagajaja"` |
| `package-lock.json` | Same (regenerate via `npm install` after package.json change) |

**E. PWA manifest ID:**

| File | Change |
|---|---|
| `src/app/manifest.ts` | `com.pixwise.app` -> `com.pagajaja.app` |

**F. Test assertions:**

| File | Change |
|---|---|
| `src/app/manifest.test.ts` | Update expected strings |
| `src/lib/claim-qr.test.ts` | `pixwise.app` -> `pagajaja.app` |
| `src/lib/sw-push.test.ts` | `pixwise.app`, "Pixwise" title |
| `src/lib/sw.test.ts` | `pixwise.app`, cache name assertions |
| `src/components/pwa/notification-prompt.test.tsx` | Session key assertion |
| `src/lib/push/web-push.test.ts` | VAPID subject |

**G. Documentation:**

| File | Change |
|---|---|
| `README.md` | Title, description, clone URL |
| `CLAUDE.md` | Project description, seed user references |
| `TESTING.md` | Opening sentence |
| `docs/production-readiness.md` | All references |
| `docs/2025-03-30-twilio-verify-consolidation.md` | 2 references |
| `playwright.config.ts` | Header comment |

**H. Logo component restructure:**

The current logo in `src/components/shared/logo.tsx` renders "Pix" + colored "wise". The new rendering should be "Paga" + colored "jaja" (or a different split based on brand guidelines -- needs clarification).

### Tasks

1. Find-replace all 47 occurrences across 33 files
2. Restructure logo.tsx text rendering
3. Regenerate `package-lock.json` after package.json rename
4. Run tests to verify no broken assertions
5. Verify seed SQL still works with new domain

---

## Workstream 4 -- Microcopy overhaul

**Agent model:** sonnet (implementation, large scope)
**Estimated scope:** 25+ component/page files

Replace all Portuguese microcopy with colloquial boteco-style pt-BR. This is the largest workstream by file count.

### Style guide for new microcopy

- Colloquial Brazilian Portuguese, as if spoken at a boteco
- Friendly, informal, uses giriass where appropriate
- Contractions: "pra" instead of "para", "ta" instead of "esta"
- Avoids formal/corporate tone
- Uses exclamation sparingly but with warmth
- Regional Brazilian humor references welcome

### Files requiring microcopy changes (grouped by section)

**Landing page (4 files):**
- `src/components/landing/hero-content.tsx` -- tagline, subtitle, CTA labels
- `src/components/landing/features-section.tsx` -- section heading, 4 feature cards
- `src/components/landing/how-it-works-section.tsx` -- 3 step cards
- `src/components/landing/cta-section.tsx` -- CTA block

**Auth flow (2 files):**
- `src/app/auth/page.tsx` -- login labels, OTP instructions, legal text
- `src/app/auth/onboard/page.tsx` -- onboarding labels, Pix step, validation messages

**App shell and navigation (1 file):**
- `src/components/app-shell.tsx` -- nav labels

**Dashboard (2 files):**
- `src/components/dashboard/dashboard-content.tsx` -- greetings, balance labels, tab labels, empty states, quick action labels
- `src/components/dashboard/debt-card.tsx` -- debt direction labels, action buttons

**Bills (2 files):**
- `src/components/bills/bills-list-content.tsx` -- page heading, status labels, filter labels, search placeholder, delete dialog
- `src/components/bill/bill-type-selector.tsx` -- type names, subtitles, examples

**Bill wizard (6+ files):**
- `src/app/app/bill/new/page.tsx` -- wizard step labels, participant labels, guest labels
- `src/components/bill/add-item-form.tsx` -- form labels
- `src/components/bill/single-amount-step.tsx` -- split method labels
- `src/components/bill/payer-step.tsx` -- payer selection text
- `src/components/bill/bill-summary.tsx` -- summary labels
- `src/components/bill/guest-claim-share-modal.tsx` -- modal labels

**Groups (2 files):**
- `src/components/groups/groups-list-content.tsx` -- page heading, create group, invite labels, empty state
- `src/app/app/groups/[id]/page.tsx` -- group detail, member management, expense status labels, settlement status

**Profile and settings (2 files):**
- `src/app/app/profile/page.tsx` -- section headings, Pix labels, preferences
- `src/app/app/settings/page.tsx` -- 2FA labels, notification labels

**Settlement (3 files):**
- `src/components/settlement/pix-qr-modal.tsx` -- modal labels, payment status
- `src/components/settlement/charge-explanation.tsx` -- breakdown labels
- `src/components/settlement/simplification-toggle.tsx` -- toggle labels

**Claim and offline (2 files):**
- `src/app/claim/[token]/page.tsx` -- claim page labels
- `public/offline.html` -- offline message

**Error handling (1 file):**
- `src/components/error-boundary.tsx` -- error titles, messages

**PWA (2 files):**
- `src/components/pwa/install-prompt.tsx` -- install instructions
- `src/components/pwa/notification-prompt.tsx` -- opt-in text

**Demo (1 file):**
- `src/app/demo/page.tsx` -- demo page labels

### Tasks

1. Draft a microcopy glossary/style sheet for boteco tone
2. Systematically update each file group above
3. Verify no hardcoded strings were missed (grep for common Portuguese words)
4. Run build to verify no JSX syntax errors from string changes

---

## Workstream 5 -- Mascot system

**Agent model:** sonnet (implementation)
**Estimated scope:** 6-8 new SVG components, 10+ integration points

### New SVG mascot components to create

Create `src/components/mascots/` directory with kawaii-style Brazilian food characters:

| Component | Character | Usage |
|---|---|---|
| `coxinha.tsx` | Kawaii coxinha | Primary mascot, loading states |
| `pastelito.tsx` | Kawaii pastel | Empty states |
| `paozito.tsx` | Kawaii pao de queijo | Error states |
| `acai-bowl.tsx` | Kawaii acai bowl | Success states |
| `brigadeiro.tsx` | Kawaii brigadeiro | Celebration/settlement complete |
| `mascot-wrapper.tsx` | Shared wrapper with emotion variants | Expression system (happy, sad, thinking, celebrating) |

### Integration points

| Location | Current | New |
|---|---|---|
| `src/components/shared/logo.tsx` | Receipt icon from Lucide | Coxinha mascot (small) or new branded icon |
| `src/components/shared/empty-state.tsx` | Generic Lucide icon prop | Add optional mascot prop alongside icon |
| Loading screens (`src/app/app/loading.tsx`, etc.) | Skeleton pulse | Add mascot with thinking expression |
| `src/components/error-boundary.tsx` | Red error box | Paozito with sad expression |
| `public/offline.html` | WiFi-off SVG | Pastelito looking confused |
| Dashboard empty states | CheckCheck icon | Brigadeiro celebrating |
| `src/app/auth/page.tsx` | Logo only | Logo + mascot greeting |
| `src/app/auth/onboard/page.tsx` | Logo only | Logo + mascot wave |
| `src/app/demo/page.tsx` | Standard layout | Mascot tour guide element |
| Settlement success in `pix-qr-modal.tsx` | Check icon | Acai bowl celebration |

### Tasks

1. Design and implement 5-6 SVG mascot components with React props for emotions
2. Create shared `MascotWrapper` for consistent sizing and animation
3. Integrate into empty states (extend `EmptyState` component with optional mascot prop)
4. Integrate into loading screens
5. Integrate into error boundary
6. Integrate into offline page
7. Update logo component to optionally include mascot
8. Add mascot to auth pages

### SVG implementation notes

- Each mascot should be a React component accepting `size`, `emotion`, and `className` props
- Use Framer Motion for idle animations (gentle bounce, blink)
- Keep SVG paths inlined (no external files) for tree-shaking
- Use current CSS custom properties for fill colors so mascots adapt to light/dark mode

---

## Workstream 6 -- PWA assets and metadata

**Agent model:** sonnet (implementation)
**Estimated scope:** 8 files + regenerated assets

Depends on WS1 (colors) and WS3 (brand name) being completed first.

### Target files

1. **`public/icon.svg`** -- redesign with Pagajaja branding (orange primary, possibly mascot-based)
2. **`public/icon-maskable.svg`** -- same with maskable safe zone
3. **`scripts/generate-icons.mjs`** -- update text, colors in screenshot SVG
4. **`src/app/manifest.ts`** -- already handled in WS3 (name) and WS1 (colors)
5. **`src/app/layout.tsx`** -- already handled in WS1 (themeColor)
6. **`public/offline.html`** -- already handled in WS1 (colors) and WS3 (name)
7. **`public/sw.js`** -- already handled in WS3 (cache names)

### Tasks

1. Design new app icon SVG with Pagajaja identity (orange background, mascot or branded symbol)
2. Create maskable variant with proper safe zone padding
3. Run `node scripts/generate-icons.mjs` to regenerate PNGs
4. Update screenshot SVG in generate-icons.mjs
5. Regenerate screenshot PNG
6. Update `src/app/manifest.ts` description with new boteco-style copy

---

## Workstream 7 -- Pix brand compliance

**Agent model:** sonnet (implementation)
**Estimated scope:** 3-5 files

### BCB (Banco Central do Brasil) Pix brand guidelines

The Pix brand has specific usage requirements:
- Minimum size: 14mm physical or equivalent pixels
- Clear space: equal to the height of the "P" in the Pix logo
- Official colors: `#32BCAD` (Pix teal) or monochrome variants
- The Pix wordmark must not be modified, recolored, or combined with other elements
- "Pix" should always be capitalized when used as a proper noun

### Affected components

1. **`src/components/settlement/pix-qr-modal.tsx`** -- QR code display area, "Pagar via Pix" / "Copiar Pix Copia e Cola" labels
2. **`src/components/dashboard/debt-card.tsx`** -- "Pagar via Pix" button
3. **`public/icon.svg`** -- currently has a Pix-style diamond symbol
4. **`public/icon-maskable.svg`** -- same
5. **Any component rendering the Pix brand mark or logo**

### Tasks

1. Add official Pix logo SVG component (`src/components/shared/pix-logo.tsx`)
2. Ensure proper minimum size and clear space wherever the Pix logo appears
3. Keep "Pix" properly capitalized in all text
4. Remove any Pix-derived symbols from the app icon (the `₱` symbol in current icon.svg is not official Pix branding)
5. Add BCB-compliant Pix badge near QR code displays

---

## Workstream 8 -- UI component restyling

**Agent model:** sonnet (implementation)
**Estimated scope:** 15+ shadcn/ui and custom components

Depends on WS1 (design tokens) being completed first. Most restyling happens automatically when CSS custom properties change, but some components have hardcoded styles.

### Components with hardcoded styles needing review

| Component | Issue |
|---|---|
| `src/components/ui/button.tsx` | Uses semantic tokens (`bg-primary`, `bg-destructive`) -- should adapt automatically |
| `src/components/app-shell.tsx` | `gradient-primary` used on FAB button -- adapts via CSS utility |
| `src/components/landing/hero-content.tsx` | `bg-primary/10`, `text-primary` -- adapts automatically |
| `src/app/auth/page.tsx` | Hardcoded oklch in step indicators (lines 388-389) |
| `src/app/auth/onboard/page.tsx` | Hardcoded oklch in step indicators (lines 464-465) |
| `public/offline.html` | Hardcoded hex colors in inline styles |
| `src/components/settlement/pix-qr-modal.tsx` | QR code `color.dark: "#1a1d2e"` hardcoded |
| `src/components/bill/guest-claim-share-modal.tsx` | QR code `color.dark: "#1a1d2e"` hardcoded |

### Radius adjustments

The current `--radius: 0.75rem` produces rounded-lg cards. The spec calls for rounded sans-serif (Nunito) -- the softer font pairs with slightly rounder UI elements. Consider bumping to `--radius: 0.875rem` or `1rem`.

### Components that adapt automatically (no changes needed)

All shadcn/ui primitives (`button`, `input`, `card`, `badge`, `avatar`, `separator`, `tabs`, `scroll-area`, `dropdown-menu`, `tooltip`, `progress`, `switch`, `label`, `dialog`, `sheet`) use semantic tokens and will inherit the new palette automatically.

### Tasks

1. Audit hardcoded oklch/hex values in non-CSS files (auth pages, QR modals, offline.html)
2. Replace with CSS custom property references where possible
3. Update QR code generation colors to use the new foreground color
4. Consider radius adjustment for softer feel with Nunito
5. Visual regression test on all major views

---

## 3. Dependency graph

```
Phase 1 (parallel, no dependencies):
  WS1: Design tokens     ─────────────────────┐
  WS2: Typography         ────────────────────┐│
                                               ││
Phase 2 (parallel, depends on WS1+WS2):       ││
  WS3: Brand rename       <────────────────────┤│
  WS4: Microcopy          <────────────────────┤│ (WS4 depends on WS3 for brand name in copy)
  WS5: Mascot system      (independent)        ││
  WS7: Pix compliance     (independent)        ││
  WS8: UI restyling       <────────────────────┘│
                                                │
Phase 3 (depends on WS1+WS3):                  │
  WS6: PWA assets         <────────────────────┘
```

### Recommended execution order

1. **WS1 + WS2** in parallel (foundational)
2. **WS3 + WS5 + WS7** in parallel (WS3 is text-only, WS5 is new components, WS7 is compliance)
3. **WS4 + WS8** in parallel (both depend on WS1 tokens being set, WS4 depends on WS3 for brand name consistency)
4. **WS6** last (needs WS1 colors + WS3 name + optionally WS5 mascot for icon)

---

## 4. Validation checklist

### After each workstream

- [ ] `npm run build` passes (type-checking)
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (unit tests)
- [ ] Manual visual check of affected views

### After all workstreams complete

- [ ] `npm run test:all` passes (unit + integration)
- [ ] `npm run test:e2e` passes (if Playwright configured)
- [ ] Light mode visual audit: landing, auth, dashboard, bill wizard, groups, profile, settings, demo
- [ ] Dark mode visual audit: same views
- [ ] Mobile responsive audit (375px, 414px)
- [ ] PWA install test: manifest loads, icon renders, offline page works
- [ ] Pix QR code generation still works end-to-end
- [ ] Push notification payload shows "Pagajaja" not "Pixwise"
- [ ] No remaining "Pixwise" or "pixwise" strings: `rg -i "pixwise" src/ public/ supabase/ scripts/ e2e/ *.md *.json *.ts`
- [ ] Service worker cache names updated (clear old `pixwise-*` caches)
- [ ] Color contrast passes WCAG 2.1 AA for all primary text/background combinations
- [ ] Font rendering: Nunito loads, tabular-nums works on financial amounts
- [ ] Pix logo meets BCB minimum size requirements

---

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Orange primary on white may fail WCAG AA contrast | High | Compute contrast ratios before finalizing; may need darker primary variant for text-on-white |
| Acid Berry Magenta as destructive color is unconventional | Medium | Test with error states and delete confirmations; ensure it reads as "danger" |
| Nunito may not support all needed font-variant-numeric features | Low | Test `tabular-nums` in Chrome/Safari; fallback to `font-variant-numeric: tabular-nums` CSS |
| PWA manifest ID change (`com.pixwise.app` -> `com.pagajaja.app`) causes re-install | Medium | Users may need to reinstall PWA; document in changelog |
| Service worker cache name change may cause stale cache issues | Medium | The existing activate handler already cleans old caches; verify it works |
| `@phone.pixwise.local` domain change breaks existing phone-auth users | High | Coordinate with database migration; existing users have this domain in `auth.users.email` |
| Microcopy overhaul may introduce PT-BR grammar issues | Medium | Native speaker review recommended |
| Mascot SVGs may bloat bundle size | Low | Keep SVGs simple, use `React.lazy` for non-critical mascots |

---

## 6. Open questions

1. **Logo text split:** The current logo renders "Pix" + "wise" (with "wise" colored). How should "Pagajaja" be split? Options: "Paga" + "jaja", "Pagaja" + "ja", or no split (full word in primary color).

2. **Domain migration:** The internal email domain `@phone.pixwise.local` and `@test.pixwise.local` are stored in the Supabase `auth.users` table. Changing the domain requires a data migration for existing users. Should this be a separate migration or coordinated with the rebrand?

3. **GitHub repository rename:** The README references `github.com/tprei/pixwise.git`. Is the repository being renamed to `pagajaja`?

4. **Orange-on-white contrast:** `#FEA101` on `#F9F9FB` has a contrast ratio of approximately 2.5:1, which fails WCAG AA (requires 4.5:1 for normal text). The primary color works for large text and interactive elements but cannot be used for body text. Need a darker variant for text usage (e.g., `#C07800` or similar).

5. **Mascot art style:** The spec mentions "kawaii-style" but doesn't provide reference art. Should an agent generate the SVG mascots from scratch, or will there be reference designs provided?

6. **Existing env vars:** Some deployments may have `VAPID_SUBJECT=mailto:contato@pixwise.app`. This is a runtime environment variable, not a code change. Document the required env var update for deployment.

7. **Pix logo source:** BCB provides official Pix logo assets at https://www.bcb.gov.br/estabilidadefinanceira/pix. Should we use the official SVG directly or recreate a compliant version?

8. **Border radius adjustment:** The spec mentions "rounded sans-serif" typography. Should the UI radius tokens also increase to match the rounder feel, or keep current `--radius: 0.75rem`?
