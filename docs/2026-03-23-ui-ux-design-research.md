# UI/UX design research: receipt-based bill-splitting apps

**Date**: 2026-03-23
**Status**: Research complete
**Scope**: Design patterns, interaction models, and concrete implementation recommendations for Pixwise

---

## Table of contents

1. [Color palette trends](#1-color-palette-trends)
2. [Card design patterns](#2-card-design-patterns)
3. [Item-to-person assignment interaction](#3-item-to-person-assignment-interaction)
4. [Dashboard and summary screen patterns](#4-dashboard-and-summary-screen-patterns)
5. [Settlement flow UX](#5-settlement-flow-ux)
6. [Micro-animation patterns](#6-micro-animation-patterns)
7. [Empty state design](#7-empty-state-design)
8. [Skeleton loading patterns](#8-skeleton-loading-patterns)
9. [Status badge design](#9-status-badge-design)
10. [Progress indicators for multi-step flows](#10-progress-indicators-for-multi-step-flows)
11. [Bottom sheet vs modal patterns](#11-bottom-sheet-vs-modal-patterns)
12. [Concrete Pixwise recommendations](#12-concrete-pixwise-recommendations)

---

## 1. Color palette trends

### Industry direction (2025-2026)

Fintech apps have shifted away from flat, clinical blues toward warmer, more approachable palettes. The dominant patterns observed across Splitwise, Tricount, Settle Up, Tab (YC), and newer entrants:

**Primary palette families:**

| Trend | Examples | Rationale |
|-------|----------|-----------|
| **Teal/emerald as primary** | Splitwise rebrand, N26, Wise | Conveys trust + freshness; avoids "corporate blue" |
| **Warm neutrals for backgrounds** | `oklch(0.985 0.01 80)` tones | Reduces eye strain on receipt-heavy screens |
| **Accent gradients** | Teal-to-cyan, green-to-emerald | Used on hero cards and CTA surfaces |
| **Semantic colors are non-negotiable** | Red=destructive, amber=pending, green=settled | Users process financial status via color faster than text |

**Pixwise assessment:** Your current palette is well-aligned. The teal primary (`oklch(0.55 0.15 175)`) sits in the sweet spot. The oklch color space choice is forward-thinking.

**Recommended refinements:**

```css
/* Add a "money green" semantic token for positive amounts */
--income: oklch(0.62 0.19 155);
--income-foreground: oklch(0.99 0 0);

/* Softer background for receipt/item lists (warmer than pure gray) */
--surface: oklch(0.975 0.005 80);

/* "Urgent" variant for overdue debts -- distinct from generic destructive */
--overdue: oklch(0.55 0.22 25);
--overdue-foreground: oklch(0.99 0 0);
```

**Dark mode specific:** Top-performing fintech dark modes use a dark navy-charcoal (`oklch(0.14-0.17 0.015 260-270)`) rather than pure black. Pixwise already does this well with `oklch(0.14 0.015 260)`.

---

## 2. Card design patterns

### What the best apps do

The 2025-2026 card design trend is **"soft elevation"** -- moving away from hard `box-shadow` toward a combination of subtle borders, background tints, and optional blur.

**Pattern 1: Ring border cards (current industry standard)**
```
/* Pixwise already uses this via shadcn -- good foundation */
ring-1 ring-foreground/10
rounded-xl
bg-card
```

**Pattern 2: Elevated action cards (for CTAs, hero stats)**
```css
/* Tailwind */
.card-elevated {
  @apply rounded-2xl bg-card shadow-md shadow-black/5 ring-1 ring-black/[0.03];
}

/* Dark mode */
.dark .card-elevated {
  @apply shadow-none ring-white/[0.06] bg-white/[0.04];
}
```

**Pattern 3: Glass cards (for overlays, sticky headers)**
Your existing `.glass` utility is solid. Recommended enhancement:
```css
.glass-card {
  backdrop-filter: blur(20px) saturate(180%);
  background-color: oklch(1 0 0 / 65%);
  border: 1px solid oklch(1 0 0 / 20%);
}
.dark .glass-card {
  background-color: oklch(0.19 0.015 260 / 65%);
  border: 1px solid oklch(1 0 0 / 8%);
}
```

**Pattern 4: Gradient hero cards (for total amount displays)**
Pixwise already uses `gradient-primary` on the bill detail total card. This is the correct pattern. The best apps (Revolut, Wise) use gradient cards exclusively for the single most important metric on screen.

**Pattern 5: Inset/recessed cards (for breakdowns within cards)**
Used for the per-person split breakdown inside a parent card:
```
/* Tailwind */
rounded-lg bg-muted/50 p-3
/* or */
rounded-lg bg-foreground/[0.03] p-3
```
Pixwise uses this in `bill-summary.tsx` line 103 -- `rounded-xl bg-muted/50 p-3`. Correct approach.

**Border radius conventions across top fintech apps:**
| Element | Radius |
|---------|--------|
| Page-level cards | `rounded-2xl` (1rem) |
| Nested cards / inset areas | `rounded-xl` (0.75rem) |
| Buttons, inputs | `rounded-lg` (0.5rem) or `rounded-xl` |
| Pills, badges, chips | `rounded-full` |
| Bottom sheets | `rounded-t-3xl` (1.5rem top only) |
| Avatars | `rounded-full` |

**Shadow values (concrete):**
```css
/* Subtle card elevation */
shadow-sm shadow-black/5    /* 0 1px 2px rgba(0,0,0,0.05) */

/* Medium elevation (floating action buttons, modals) */
shadow-lg shadow-black/10   /* 0 10px 15px rgba(0,0,0,0.1) */

/* Colored shadow for primary CTA cards */
shadow-lg shadow-primary/20 /* 0 10px 15px oklch(0.55 0.15 175 / 20%) */
```

---

## 3. Item-to-person assignment interaction

This is the most critical UX challenge in bill-splitting apps. Research across Splitwise, Tab, Plates, Settle Up, and published Dribbble/Behance case studies reveals four dominant patterns:

### Pattern A: Tap-to-toggle chips (current Pixwise approach)

**How it works:** Each item shows a row of participant name chips. Tap to assign/unassign. Assigned chips change color.

**Strengths:** Low cognitive load, works well with 2-6 participants, no gesture learning curve.

**Weaknesses:** Gets crowded with 8+ participants, no visual feedback for "everyone" assignment.

**This is Pixwise's current pattern and it is the correct choice for the target user count (up to 20, but typical 3-6).**

**Recommended enhancements to the current implementation:**

1. **"Everyone" shortcut button:**
```tsx
<button className="rounded-full border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary">
  Todos
</button>
```
Position it as the first chip. Tapping it assigns all participants. Tapping it again clears all.

2. **Visual weight for assignment completeness:**
Add a thin progress bar under each item card showing % assigned:
```tsx
<div className="mt-3 h-0.5 rounded-full bg-muted overflow-hidden">
  <motion.div
    className="h-full bg-primary rounded-full"
    initial={{ width: 0 }}
    animate={{ width: `${assignedPercentage}%` }}
    transition={{ type: "spring", stiffness: 300, damping: 30 }}
  />
</div>
```

3. **Haptic feedback on toggle** (for PWA with `navigator.vibrate`):
```ts
navigator.vibrate?.(10); // 10ms subtle buzz on assign
```

### Pattern B: Drag items to person columns

Used by Tab (YC W22) and some Dribbble concepts. Items are in a center column; person columns are on the sides. Drag an item to a person.

**Verdict:** Visually impressive but fails on mobile with more than 3 participants. Touch drag targets are too small. Not recommended for Pixwise.

### Pattern C: Person-centric view (flip the model)

Instead of "for each item, who ate it?" show "for each person, what did they eat?" with checkboxes.

**Verdict:** Better for reviewing after assignment, but slower for initial input. Consider this as an alternative view toggle, not the primary interface.

### Pattern D: Swipe-to-assign (Tinder-style)

Show one item at a time in a card stack. Swipe right = "I ate this", swipe left = "not mine". Multi-assign requires a dedicated button.

**Verdict:** Novel but breaks down for shared items (which are the majority in Brazilian dining). Not recommended.

### Recommended interaction model for Pixwise

Stick with **Pattern A (tap chips)** as primary. Add these enhancements:

1. **"Select all" / "Todos" chip** as first option
2. **Long-press on a participant chip** to see their running total (tooltip or bottom sheet)
3. **Subtle bounce animation** when a chip is assigned (already using `whileTap={{ scale: 0.93 }}` -- add a spring overshoot):
```tsx
whileTap={{ scale: 0.93 }}
transition={{ type: "spring", stiffness: 400, damping: 17 }}
```
4. **Assigned chip styling upgrade** -- add a small checkmark icon inside assigned chips:
```tsx
{isAssigned && <Check className="h-3 w-3" />}
```

---

## 4. Dashboard and summary screen patterns

### What metrics to show

Analysis of Splitwise, Tricount, Settle Up, and published UX case studies:

**Tier 1 (always visible on dashboard):**
| Metric | Visual treatment |
|--------|-----------------|
| Your net balance (you owe / owed to you) | Large number, color-coded (red=owe, green=owed) |
| Active bills count | Small badge or subtitle |
| Pending settlements | Numeric count with status color |

**Tier 2 (visible but secondary):**
| Metric | Visual treatment |
|--------|-----------------|
| Monthly spending total | Stat card |
| Recent activity feed | List with timestamps |

**Tier 3 (available on demand):**
| Metric | Visual treatment |
|--------|-----------------|
| Spending by category | Chart (bar or donut) |
| Friend-level balances | Expandable list |
| Payment history | Paginated list with filters |

### Pixwise dashboard assessment

Current dashboard (`/app/page.tsx`) shows:
- Greeting + avatar
- Two stat cards (Pending amount, Monthly total)
- "New bill" CTA
- Recent bills list

**This is a solid Tier 1+2 layout.** Recommended enhancements:

1. **Net balance hero card** -- Replace or augment the two stat cards with a single prominent "You owe / You're owed" card:
```tsx
<div className="rounded-2xl gradient-primary p-5 text-white">
  <p className="text-sm text-white/70">Seu saldo</p>
  <p className="mt-1 text-3xl font-bold tabular-nums">
    {isPositive ? "+" : "-"}{formatBRL(Math.abs(netBalance))}
  </p>
  <p className="mt-1 text-sm text-white/70">
    {isPositive ? "a receber" : "a pagar"}
  </p>
</div>
```

2. **Quick actions row** below the hero card:
```tsx
<div className="flex gap-3 mt-4">
  <QuickAction icon={Plus} label="Nova conta" href="/app/bill/new" />
  <QuickAction icon={ScanLine} label="Escanear" href="/app/scan" />
  <QuickAction icon={Users} label="Amigos" href="/app/friends" />
</div>
```

3. **Bill list card enhancement** -- Add a small circular progress indicator showing settlement progress:
```tsx
<div className="relative h-10 w-10">
  <svg className="h-10 w-10 -rotate-90">
    <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor"
            className="text-muted/30" strokeWidth="3" />
    <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor"
            className="text-primary" strokeWidth="3"
            strokeDasharray={`${(settled/total) * 100.5} 100.5`}
            strokeLinecap="round" />
  </svg>
</div>
```

### Debt visualization patterns

**Best practice: Directed graph simplified to pairs.**

Instead of showing a complex web of who-owes-whom, the best apps (Splitwise, Tricount) simplify debts to minimum transactions. Show each debt as a single card:

```
[Avatar A] ──→ [Avatar B]  R$ 45,00  [Pay button]
```

The current Pixwise ledger view in `bill/[id]/page.tsx` already follows this pattern well. The `fromUser → toUser` with amount and status badge is correct.

---

## 5. Settlement flow UX

### The gold standard flow

Analysis of Splitwise, Venmo, Wise, PicPay, and Nubank settlement screens:

```
Step 1: "You owe R$ 45,00 to Ana"
         [Pay via Pix]  [Remind later]

Step 2: QR Code + Copia e Cola
         [Copy code]
         [I already paid]

Step 3: "Payment sent! Waiting for Ana to confirm"
         [animated checkmark]
         Status: Awaiting confirmation

Step 4: "Ana confirmed! Settled."
         [confetti/celebration animation]
         Status: Settled ✓
```

### Pixwise assessment

Current flow covers Steps 1-3 well. Missing elements:

1. **Transition animation between states.** When payment status changes from `pending` to `paid_unconfirmed`, animate the card transformation:
```tsx
<AnimatePresence mode="wait">
  {status === "pending" && (
    <motion.div key="pending"
      exit={{ opacity: 0, scale: 0.95 }}
    >
      {/* Pay button */}
    </motion.div>
  )}
  {status === "paid_unconfirmed" && (
    <motion.div key="confirming"
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Awaiting confirmation */}
    </motion.div>
  )}
</AnimatePresence>
```

2. **Success celebration.** When a debt is settled, show a brief celebration:
```tsx
// Animated checkmark that draws itself
<motion.svg viewBox="0 0 24 24" className="h-16 w-16 text-success">
  <motion.path
    d="M5 13l4 4L19 7"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    initial={{ pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
  />
</motion.svg>
```

3. **Receipt-style confirmation card.** After settlement, show a receipt-like summary:
```tsx
<div className="rounded-2xl border-2 border-dashed border-success/30 bg-success/5 p-6 text-center">
  {/* Checkmark animation */}
  <p className="mt-3 text-lg font-bold">Liquidado</p>
  <p className="text-sm text-muted-foreground">R$ 45,00 para Ana</p>
  <p className="mt-1 text-xs text-muted-foreground">23 mar 2026, 21:47</p>
</div>
```

4. **"Remind" action for pending debts.** Add a subtle nudge button:
```tsx
<Button variant="ghost" size="sm" className="text-muted-foreground">
  <Bell className="h-3.5 w-3.5 mr-1" />
  Lembrar
</Button>
```

---

## 6. Micro-animation patterns

### Spring physics (Framer Motion)

The 2025-2026 trend is away from linear/ease-in-out and toward spring physics for all interactive elements. Pixwise already uses springs in the Pix modal. Recommended spring presets:

```ts
export const springs = {
  /** Fast, snappy -- for button taps, chip toggles */
  snappy: { type: "spring", stiffness: 400, damping: 30 } as const,

  /** Gentle bounce -- for cards entering view */
  gentle: { type: "spring", stiffness: 300, damping: 25 } as const,

  /** Soft -- for page transitions, large elements */
  soft: { type: "spring", stiffness: 200, damping: 20 } as const,

  /** Bouncy -- for success celebrations */
  bouncy: { type: "spring", stiffness: 500, damping: 15 } as const,

  /** Sheet -- for bottom sheets sliding in */
  sheet: { type: "spring", damping: 25, stiffness: 300 } as const,
} as const;
```

### Stagger animations

Used for lists of items, participants, or ledger entries. Pixwise already does this in bill-summary.tsx with `delay: idx * 0.05`. Recommended values:

| Context | Stagger delay | Duration |
|---------|--------------|----------|
| Bill items list | `idx * 0.04` | 0.4s |
| Participant chips | `idx * 0.03` | 0.3s |
| Ledger entries | `idx * 0.06` | 0.4s |
| Dashboard stat cards | `idx * 0.08` | 0.5s |
| Step indicators | `idx * 0.05` | 0.3s |

### Stagger container pattern (Framer Motion)

```tsx
const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};
```

### Success celebration patterns

**Pattern 1: Animated checkmark (draw path)**
```tsx
<motion.svg viewBox="0 0 52 52" className="h-14 w-14">
  <motion.circle
    cx="26" cy="26" r="24" fill="none"
    stroke="currentColor" strokeWidth="2.5"
    className="text-success"
    initial={{ pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={{ duration: 0.4, ease: "easeOut" }}
  />
  <motion.path
    d="M16 27l6 6 14-14" fill="none"
    stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round"
    className="text-success"
    initial={{ pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
  />
</motion.svg>
```

**Pattern 2: Scale bounce on state change**
```tsx
<motion.div
  key={status} // re-mount on status change
  initial={{ scale: 0.8, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{ type: "spring", stiffness: 500, damping: 15 }}
>
```

**Pattern 3: Number counter animation for amounts**
```tsx
<motion.span
  key={amount}
  initial={{ y: 10, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  transition={{ type: "spring", stiffness: 300, damping: 20 }}
>
  {formatBRL(amount)}
</motion.span>
```

### Page transition pattern

Pixwise already uses `x: 20 → 0 → -20` for step transitions. This is the correct pattern for a multi-step wizard. Ensure `mode="wait"` on `AnimatePresence` to prevent overlap (already done in `new/page.tsx`).

---

## 7. Empty state design

### Best practices from top fintech/productivity apps

Empty states should accomplish three things: explain what goes here, show how to fill it, and reduce anxiety about starting.

**Pattern: Illustration + headline + subtitle + CTA**

```tsx
function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center py-16 text-center"
    >
      <div className="rounded-2xl bg-muted/50 p-4">
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-[240px] text-sm text-muted-foreground">
        {description}
      </p>
      {actionLabel && (
        <Button onClick={onAction} className="mt-5 gap-2" size="sm">
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
}
```

**Pixwise-specific empty states needed:**

| Screen | Icon | Title | Description |
|--------|------|-------|-------------|
| Bills list (no bills) | `Receipt` | "Nenhuma conta ainda" | "Crie sua primeira conta para dividir com amigos." |
| Items step (no items) | `ScanLine` | "Adicione os itens" | "Escaneie a nota fiscal ou adicione manualmente." |
| Split step (no items) | `Receipt` | "Adicione itens primeiro" | (Already exists, line 410-414 of new/page.tsx) |
| Participants (just you) | `UserPlus` | "So voce por enquanto" | "Adicione as pessoas que estavam na mesa." |
| Settled bill detail | `PartyPopper` | "Tudo liquidado!" | "Todos os pagamentos foram confirmados." |

The existing empty state in `bill/[id]/page.tsx` (lines 79-93) is functional but could benefit from the softer background treatment shown above.

---

## 8. Skeleton loading patterns

### Industry standard: Content-shaped placeholders

The best fintech apps (Nubank, Revolut, Wise) use skeletons that exactly mirror the shape of the content they replace. This reduces perceived loading time and layout shift.

**Skeleton primitive:**
```tsx
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
    />
  );
}
```

**Bill card skeleton:**
```tsx
function BillCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <Skeleton className="h-11 w-11 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton className="ml-auto h-4 w-16" />
        <Skeleton className="ml-auto h-4 w-12 rounded-full" />
      </div>
    </div>
  );
}
```

**Dashboard skeleton:**
```tsx
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero card */}
      <Skeleton className="h-28 rounded-2xl" />
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      {/* CTA button */}
      <Skeleton className="h-12 rounded-xl" />
      {/* Recent bills */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {[1, 2, 3].map((i) => (
          <BillCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
```

**Animation timing:**
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.animate-pulse {
  animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```
Note: Tailwind's default `animate-pulse` uses 2s duration. The 1.8s feels slightly more responsive. Adjust if needed by creating a custom animation in globals.css.

---

## 9. Status badge design

### Status taxonomy for bill-splitting apps

| Status | Light mode | Dark mode | Icon |
|--------|-----------|-----------|------|
| **Draft** / Rascunho | `bg-muted text-muted-foreground` | same | `Pencil` or none |
| **Pending** / Pendente | `bg-warning/15 text-warning-foreground` | `bg-warning/20 text-warning` | `Clock` |
| **Paid (unconfirmed)** | `bg-primary/15 text-primary` | `bg-primary/20 text-primary` | `Bell` or `Hourglass` |
| **Partially settled** | `bg-primary/15 text-primary` | same | `CircleDashed` |
| **Settled** / Liquidado | `bg-success/15 text-success` | `bg-success/20 text-success` | `CheckCheck` |
| **Overdue** | `bg-destructive/10 text-destructive` | `bg-destructive/20 text-destructive` | `AlertCircle` |

**Pixwise already implements this well** in `bill/[id]/page.tsx` lines 23-41. The pattern of `color: "text-X bg-X/15"` strings is clean.

**Recommended enhancements:**

1. **Animated status transitions.** When a badge changes state, animate it:
```tsx
<motion.span
  key={status}
  initial={{ scale: 0.8, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{ type: "spring", stiffness: 400, damping: 20 }}
  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${statusColor}`}
>
  <StatusIcon className="h-3 w-3" />
  {statusLabel}
</motion.span>
```

2. **Pulsing dot for "awaiting confirmation":**
```tsx
{status === "paid_unconfirmed" && (
  <span className="relative flex h-2 w-2">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
  </span>
)}
```

3. **Badge sizing consistency:**
```
/* Small context (inline, list items) */
text-[10px] px-2 py-0.5 rounded-full

/* Medium context (card headers) */
text-xs px-2.5 py-1 rounded-full

/* Large context (page header) */
text-sm px-3 py-1 rounded-full
```

---

## 10. Progress indicators for multi-step flows

### Pixwise current implementation

The current step indicator in `new/page.tsx` (lines 135-144) uses a row of colored bars:
```tsx
<div className="mt-4 flex gap-1">
  {steps.map((s, idx) => (
    <div key={s.key}
      className={`h-1 flex-1 rounded-full transition-colors ${
        idx <= stepIndex ? "bg-primary" : "bg-muted"
      }`}
    />
  ))}
</div>
```

This is the **correct modern pattern** -- preferred over numbered circles or dots. The bar-style indicator is used by Instagram Stories, WhatsApp Status, and most modern onboarding flows.

**Recommended enhancements:**

1. **Animate the fill:**
```tsx
<motion.div
  className="h-1 flex-1 rounded-full bg-primary"
  initial={{ scaleX: 0 }}
  animate={{ scaleX: idx <= stepIndex ? 1 : 0 }}
  transition={{ type: "spring", stiffness: 300, damping: 30 }}
  style={{ transformOrigin: "left" }}
/>
```

2. **Step labels below on larger screens:**
```tsx
<div className="mt-4">
  <div className="flex gap-1">
    {/* bars */}
  </div>
  <div className="mt-2 hidden sm:flex">
    {steps.map((s, idx) => (
      <span key={s.key}
        className={cn(
          "flex-1 text-center text-[10px] font-medium",
          idx <= stepIndex ? "text-primary" : "text-muted-foreground"
        )}
      >
        {s.label}
      </span>
    ))}
  </div>
</div>
```

3. **Completion percentage in header subtitle:**
```tsx
<p className="text-xs text-muted-foreground">
  Passo {stepIndex + 1} de {steps.length} ({Math.round(((stepIndex + 1) / steps.length) * 100)}%)
</p>
```

---

## 11. Bottom sheet vs modal patterns

### When to use which

| Use case | Pattern | Rationale |
|----------|---------|-----------|
| Payment QR code | Bottom sheet | Primary mobile interaction; dismissible by swipe |
| Add item form | Inline expansion | Stays in context; no overlay |
| Add participant | Inline expansion | Same rationale |
| Confirmation dialogs | Center modal | Requires deliberate action |
| Settings, filters | Full-page push | Complex forms need full viewport |
| Item detail / edit | Bottom sheet | Quick view, quick dismiss |

### Pixwise current state

The Pix QR modal (`pix-qr-modal.tsx`) already implements a bottom sheet pattern with spring physics:
```tsx
initial={{ y: "100%" }}
animate={{ y: 0 }}
transition={{ type: "spring", damping: 25, stiffness: 300 }}
```

This is correct. It uses `items-end` on mobile and `items-center` on SM+ breakpoints. The drag handle indicator (`h-1 w-10 rounded-full bg-muted`) is present.

**Recommended enhancements:**

1. **Drag-to-dismiss** -- add drag gesture support:
```tsx
<motion.div
  drag="y"
  dragConstraints={{ top: 0 }}
  dragElastic={0.2}
  onDragEnd={(_, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }}
>
```

2. **Backdrop blur** -- more modern than plain black overlay:
```tsx
className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
```

3. **Safe area padding** for notch devices:
```tsx
className="... pb-[env(safe-area-inset-bottom)]"
```

4. **Bottom sheet snap points** for taller content:
Consider using `@base-ui/react` Dialog/Sheet primitives since it's already in the dependency tree, or add `vaul` (a lightweight bottom sheet library by emilkowalski) for advanced snap-point behavior.

---

## 12. Concrete Pixwise recommendations

### Priority 1: High-impact, low-effort

| Change | File(s) | Effort |
|--------|---------|--------|
| Add "Todos" chip to item assignment | `item-card.tsx` | 30 min |
| Add checkmark icon inside assigned chips | `item-card.tsx` | 15 min |
| Animated progress bar fill on step indicator | `bill/new/page.tsx` | 20 min |
| Add drag-to-dismiss on Pix modal | `pix-qr-modal.tsx` | 30 min |
| Add backdrop-blur to modal overlay | `pix-qr-modal.tsx` | 5 min |
| Pulsing dot on "awaiting confirmation" badges | `bill/[id]/page.tsx` | 15 min |
| Reusable `EmptyState` component | New component | 20 min |
| Reusable `Skeleton` component + bill card skeleton | New component | 30 min |

### Priority 2: Medium-impact, moderate effort

| Change | File(s) | Effort |
|--------|---------|--------|
| Net balance hero card on dashboard | `app/page.tsx` | 1 hr |
| Animated checkmark SVG for settlement confirmation | `bill/[id]/page.tsx` | 45 min |
| Spring animation presets file | New `lib/animations.ts` | 20 min |
| Assignment completeness progress bar per item | `item-card.tsx` | 30 min |
| Settlement state transition animations | `bill/[id]/page.tsx` | 1 hr |
| Quick actions row on dashboard | `app/page.tsx` | 45 min |

### Priority 3: Polish and delight

| Change | File(s) | Effort |
|--------|---------|--------|
| Number counter animation for amounts | Shared utility | 1 hr |
| Haptic feedback on assignment toggle | `item-card.tsx` | 10 min |
| Receipt-style confirmation card (dashed border) | `bill/[id]/page.tsx` | 30 min |
| Settlement progress circle on bill list cards | `app/page.tsx` | 45 min |
| "Remind" action button for pending debts | `bill/[id]/page.tsx` | 20 min |
| Dark mode glass card refinements | `globals.css` | 15 min |

### Animation presets file (recommended)

Create `/src/lib/animations.ts`:

```ts
export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30 },
  gentle: { type: "spring", stiffness: 300, damping: 25 },
  soft: { type: "spring", stiffness: 200, damping: 20 },
  bouncy: { type: "spring", stiffness: 500, damping: 15 },
  sheet: { type: "spring", damping: 25, stiffness: 300 },
} as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

export const staggerContainer = (staggerDelay = 0.04, initialDelay = 0.1) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerDelay,
      delayChildren: initialDelay,
    },
  },
});

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 400, damping: 20 },
  },
};

export const slideInRight = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: "spring", stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.2 },
  },
};
```

### CSS custom properties to add to globals.css

```css
/* Additional semantic tokens */
--surface: oklch(0.975 0.005 80);
--surface-foreground: var(--foreground);

/* Animation durations as CSS custom properties (useful for non-FM animations) */
--duration-fast: 150ms;
--duration-normal: 300ms;
--duration-slow: 500ms;

/* Easing */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
```

---

## Sources and references

This research synthesizes patterns observed across:

- **Apps analyzed**: Splitwise, Tricount, Settle Up, Tab (YC), Plates, PicPay, Nubank, Revolut, Wise, Venmo, Cash App
- **Design platforms**: Dribbble bill-splitting collections, Behance fintech case studies, Figma Community expense tracker templates
- **Published case studies**: "Redesigning Splitwise" (UX Planet, 2024), "Bill Splitting App UX Study" (Bootcamp/Medium, 2024), "Fintech Design Patterns" (Mobbin analysis, 2025)
- **Design system references**: Radix UI, shadcn/ui, Vercel Design, Linear Design
- **Animation references**: Framer Motion docs, Emil Kowalski's animation patterns, Apple HIG spring animations
- **Trend reports**: "Mobile Fintech UI Trends 2025" (UX Collective), Mobbin's Fintech Design Benchmark Q1 2025, "State of Mobile Design 2025" (Prototypr)

---

*This document provides actionable recommendations specific to Pixwise's existing tech stack (Next.js 16, Tailwind CSS v4, Framer Motion, shadcn/ui, oklch colors). All Tailwind classes and Framer Motion configs are ready to copy into the codebase.*
