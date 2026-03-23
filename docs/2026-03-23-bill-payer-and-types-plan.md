# Bill payer tracking, bill types, and debt simplification

**Date**: 2026-03-23
**Status**: Draft
**Scope**: Three features -- bill creation wizard changes (payer tracking, bill type selection) and a post-creation debt simplification system with step-by-step visualization

---

## Table of contents

1. [Current state summary](#1-current-state-summary)
2. [Feature 1 -- who paid the bill](#2-feature-1----who-paid-the-bill)
3. [Feature 2 -- bill type selection](#3-feature-2----bill-type-selection)
4. [Feature 3 -- debt simplification with visualization](#4-feature-3----debt-simplification-with-visualization)
5. [Type changes](#5-type-changes)
6. [Store changes](#6-store-changes)
7. [New components](#7-new-components)
8. [Existing file changes](#8-existing-file-changes)
9. [Wizard step order](#9-wizard-step-order)
10. [Ledger computation rewrite](#10-ledger-computation-rewrite)
11. [Simplification algorithm](#11-simplification-algorithm)
12. [Edge cases and validation](#12-edge-cases-and-validation)
13. [Implementation order](#13-implementation-order)
14. [Manual test checklist](#14-manual-test-checklist)

---

## 1. Current state summary

### What exists

- **Types** (`src/types/index.ts`): `Bill`, `BillItem`, `ItemSplit`, `LedgerEntry`, `ParticipantSummary`, `DebtSummary`. No concept of "who paid" -- `creatorId` is implicitly the payer.
- **Store** (`src/stores/bill-store.ts`): Zustand store with `computeLedger()` that hard-codes `toUserId: creatorId` on every ledger entry. All debts flow toward the creator.
- **Wizard** (`src/app/app/bill/new/page.tsx`): Five steps: `info` -> `participants` -> `items` -> `split` -> `summary`. No bill type selection. No payer selection.
- **Summary** (`src/components/bill/bill-summary.tsx`): Displays per-person breakdowns. Does not show who paid or who receives money.
- **Bill detail** (`src/app/app/bill/[id]/page.tsx`): Three tabs (items, split, payment). Ledger entries always show `fromUser -> toUser` where `toUser` is the creator.

### Key assumption to break

The entire ledger computation assumes a single payer (the creator). Both features require removing this assumption.

---

## 2. Feature 1 -- who paid the bill

### Requirements

1. Track one or more payers, each with a specific amount paid (in centavos).
2. Most common case: one person paid the entire bill. Optimize the UI for this.
3. Support split payment at the restaurant: two or more people each put a card down for a portion.
4. Quick action buttons:
   - **"Pagou tudo"** -- assigns 100% to a single person with one tap.
   - **"Dividiu igualmente"** -- splits the total amount equally among selected payers.
5. The payer can be any participant (not just the creator).
6. Validation: the sum of all payer amounts must equal the bill grand total (items + service fee + fixed fees).

### Data model

A new `BillPayer` type tracks each payer's contribution:

```ts
interface BillPayer {
  userId: string;
  amountCents: number;
}
```

Stored on the `Bill` as `payers: BillPayer[]`. When `payers` is empty or undefined, fall back to `[{ userId: creatorId, amountCents: grandTotal }]` for backward compatibility.

### Ledger impact

Debts no longer flow to a single person. For each non-payer participant, their total owed amount gets distributed across payers proportionally to each payer's share of the total payment. See [section 10](#10-ledger-computation-rewrite) for the algorithm.

---

## 3. Feature 2 -- bill type selection

### Requirements

1. Before the wizard begins, show a choice screen with two options:
   - **"Valor unico"** (single amount): one total to split. No items, no item-level assignment.
   - **"Varios itens"** (itemized): the current restaurant flow with individual items and per-item assignment.
2. Single-amount bills support three split methods:
   - **Equal**: total divided evenly among all participants.
   - **Percentage**: each participant assigned a percentage (must sum to 100%).
   - **Fixed**: each participant assigned a fixed amount (must sum to the total).
3. Single-amount bills skip the "items" and per-item "split" steps entirely.
4. The "info" step for single-amount bills adds a total amount input field and a split method selector.

### Data model

A new `BillType` discriminator on `Bill`:

```ts
type BillType = "single_amount" | "itemized";
```

For single-amount bills, the split is stored differently -- no `BillItem` rows exist. Instead, each participant's share is computed from a `BillSplit` record:

```ts
interface BillSplit {
  userId: string;
  splitType: SplitType; // "equal" | "percentage" | "fixed"
  value: number;        // percentage (0-100) or fixed amount in centavos
  computedAmountCents: number;
}
```

This parallels `ItemSplit` but operates at the bill level rather than the item level.

---

## 4. Feature 3 -- debt simplification with visualization

### Requirements

1. A toggle on the bill detail / settlement screen: **"Simplificar dividas"**.
2. When enabled, run a min-transactions algorithm to reduce the number of Pix transfers needed to settle all debts.
3. Present a **paginated step-by-step visualization** ("book") showing how the algorithm simplified the debt graph:
   - Page 1: original debt graph (all edges from `computeLedger`).
   - Pages 2..N: each intermediate step, showing which debt was resolved or merged.
   - Final page: the simplified result (minimum transactions).
   - Navigation via left/right arrows or swipe gestures.
4. Each page renders a directed graph: circles (participants) arranged in a ring, curved arrows between them labeled with amounts.
5. Transitions between pages are animated: edges fade in/out, amounts morph via number interpolation.
6. The toggle shows a before/after transaction count: "3 transacoes -> 2 transacoes".
7. When simplification is active, the payment tab uses the simplified ledger entries (fewer, possibly different pairings) instead of the raw computed ones.

### Data model

No new persistent types needed. The simplification is a pure function of the ledger and produces derived data:

```ts
interface SimplificationStep {
  balances: Map<string, number>;
  edges: DebtEdge[];
  description: string; // e.g. "Ana paga R$45 para Pedro (simplificado)"
}

interface DebtEdge {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

interface SimplificationResult {
  originalEdges: DebtEdge[];
  steps: SimplificationStep[];
  simplifiedEdges: DebtEdge[];
  originalCount: number;
  simplifiedCount: number;
}
```

These types live in `src/lib/simplify.ts` alongside the algorithm, not in the shared types file -- they're internal to the simplification module.

### Algorithm overview

The classic greedy min-transactions approach:

1. Compute net balance for each person from the original ledger entries.
2. Separate into creditors (positive net) and debtors (negative net).
3. Sort creditors descending by amount, debtors ascending (most negative first).
4. Match the largest debtor with the largest creditor. Transfer `min(|debtorBalance|, creditorBalance)`.
5. Record the step (balances, edges, description).
6. Zero out whichever side was fully settled; reduce the other.
7. Repeat until all balances are zero.

This is the same greedy algorithm already described in [section 10](#10-ledger-computation-rewrite) for `computeLedger` with multi-payer support, and detailed further in [section 11](#11-simplification-algorithm). The difference is that here we record each intermediate step for the visualization, and the input is the raw ledger (which may have redundant edges when the user chose not to simplify during ledger generation).

### Why a separate module

`computeLedger` in the store already produces a minimal set of entries when multi-payer is involved (section 10 algorithm). But for complex cases -- especially when multiple bills across a group create cross-debts -- the simplification visualization shows the user *why* certain debts merged. The step-by-step "book" is educational and builds trust in the system's math.

The toggle also lets users opt out: some people prefer to see the direct "I owe Pedro R$ 50 for dinner" entries rather than a simplified "I owe Pedro R$ 30 net."

---

## 5. Type changes

**File**: `src/types/index.ts`

### New types to add

```ts
type BillType = "single_amount" | "itemized";

interface BillPayer {
  userId: string;
  amountCents: number;
}

interface BillSplit {
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}
```

### Modified types

**`Bill`** -- add three fields:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `billType` | `BillType` | `"itemized"` | Discriminates between single-amount and itemized flows |
| `payers` | `BillPayer[]` | `[]` | Who paid and how much each |
| `totalAmountInput` | `number` | `0` | User-entered total for single-amount bills (centavos) |

**`ParticipantSummary`** -- modify `debts` to potentially have multiple `toUserId` targets (already supports this via the `DebtSummary[]` array, so no structural change needed).

**`BillWithDetails`** -- add `payers: BillPayer[]` and `billSplits: BillSplit[]` to the extended type.

---

## 6. Store changes

**File**: `src/stores/bill-store.ts`

### New state fields

```ts
interface BillState {
  // ... existing fields ...
  payers: BillPayer[];
  billSplits: BillSplit[];

  // New actions
  setBillType: (billType: BillType) => void;
  setPayers: (payers: BillPayer[]) => void;
  setPayerFull: (userId: string) => void;
  splitPaymentEqually: (userIds: string[]) => void;
  setPayerAmount: (userId: string, amountCents: number) => void;
  removePayerEntry: (userId: string) => void;

  setBillSplit: (userId: string, splitType: SplitType, value: number) => void;
  splitBillEqually: (userIds: string[]) => void;
  splitBillByPercentage: (assignments: { userId: string; percentage: number }[]) => void;
  splitBillByFixed: (assignments: { userId: string; amountCents: number }[]) => void;
}
```

### Action behaviors

**`setBillType(billType)`**: Sets `bill.billType`. When switching to `"single_amount"`, clears `items` and `splits`. When switching to `"itemized"`, clears `billSplits`.

**`setPayerFull(userId)`**: Sets `payers` to `[{ userId, amountCents: grandTotal }]`. This is the "Pagou tudo" quick action.

**`splitPaymentEqually(userIds)`**: Divides the grand total equally among the given user IDs, handling remainder centavos.

**`setPayerAmount(userId, amountCents)`**: Upserts a single payer entry. Used for manual multi-payer entry.

**`removePayerEntry(userId)`**: Removes a payer from the list.

**`splitBillEqually(userIds)`**: For single-amount bills. Computes `computedAmountCents` for each user as `floor(totalAmountInput / count)` with remainder distribution.

**`splitBillByPercentage(assignments)`**: For single-amount bills. Each assignment has a `percentage` (0-100). Computes `computedAmountCents` as `round(totalAmountInput * percentage / 100)`.

**`splitBillByFixed(assignments)`**: For single-amount bills. Each assignment has an `amountCents`. The `computedAmountCents` equals `amountCents` directly.

### `createBill` change

Add `billType` parameter. Default to `"itemized"` for backward compatibility:

```ts
createBill: (title: string, billType: BillType, merchantName?: string) => void;
```

### `computeLedger` rewrite

See [section 10](#10-ledger-computation-rewrite) for the full algorithm.

### `getParticipantTotal` change

For single-amount bills, read from `billSplits` instead of `splits` (item-level). Service fee and fixed fee logic stays the same for itemized bills. For single-amount bills, the `totalAmountInput` already includes everything (the user enters the final amount), so service fee and fixed fee fields are hidden/zeroed.

### `recalcTotal` change

For single-amount bills, `totalAmount` comes from `totalAmountInput` (user-entered), not from summing items.

---

## 7. New components

### 7.1 `BillTypeSelector`

**File**: `src/components/bill/bill-type-selector.tsx`

Full-screen choice presented before the wizard. Two large, tappable cards:

| Card | Icon | Title | Subtitle | Examples |
|------|------|-------|----------|----------|
| Left | `Receipt` | Valor unico | Um valor total para dividir | Airbnb, Uber, assinatura, voo |
| Right | `ScanLine` | Varios itens | Conta detalhada com itens | Restaurante, bar, mercado |

Selecting a card calls `setBillType()` on the store and advances to the wizard.

**Props**: `onSelect: (billType: BillType) => void`

### 7.2 `PayerStep`

**File**: `src/components/bill/payer-step.tsx`

The "Quem pagou a conta" step. Shows all participants with tap-to-select. Displays:

1. **Grand total** at the top (read from store).
2. **Participant list** -- each participant as a tappable card. Tapping sets them as the sole payer via "Pagou tudo".
3. **Quick action buttons**:
   - "Pagou tudo" (appears below participant when selected, confirming single payer)
   - "Dividir pagamento" (toggle to multi-payer mode)
4. **Multi-payer mode**: When toggled, shows amount input next to each selected payer. A running total and remaining amount display at the bottom.
5. **Validation bar**: Shows sum of payer amounts vs grand total. Disables "Proximo" if they don't match.

**State flow**:
- Default: single-payer mode. Creator is pre-selected.
- Tapping another participant switches to them as sole payer.
- "Dividir pagamento" expands to multi-payer mode with amount inputs.
- "Dividiu igualmente" quick action in multi-payer mode splits evenly among selected payers.

### 7.3 `SingleAmountStep`

**File**: `src/components/bill/single-amount-step.tsx`

Replaces the "items" and "split" steps for single-amount bills. Contains:

1. **Total amount input**: Large, prominent currency input field. Centavo-aware parsing via `parseBRLInput`.
2. **Split method selector**: Three segmented-control options -- Igual, Porcentagem, Valor fixo.
3. **Split assignment area** (varies by method):
   - **Igual**: Just a summary showing "R$ X,XX por pessoa" with participant avatars. No interaction needed beyond confirming.
   - **Porcentagem**: Each participant has a percentage input. A running total shows current sum vs 100%. A "Dividir igualmente" button pre-fills equal percentages.
   - **Valor fixo**: Each participant has an amount input. A running total shows current sum vs the bill total. A "Dividir igualmente" button pre-fills equal amounts.

### 7.4 `PayerSummaryCard`

**File**: `src/components/bill/payer-summary-card.tsx`

A small card used in `BillSummary` and the bill detail page showing who paid:

```
[Avatar] Pedro pagou R$ 345,00
[Avatar] Ana pagou R$ 100,00
```

Or for single payer: `Pedro pagou a conta toda (R$ 345,00)`

### 7.5 `DebtGraph`

**File**: `src/components/settlement/debt-graph.tsx`

An SVG-based component that renders a directed graph of debts. Participants are arranged in a circle. Curved arrows connect debtors to creditors, labeled with amounts.

**Props**:

```ts
interface DebtGraphProps {
  participants: User[];
  edges: DebtEdge[];
  highlightEdge?: { from: string; to: string }; // edge being resolved in current step
  fadingEdges?: { from: string; to: string }[];  // edges being removed
}
```

**Layout**:
- Participants placed evenly on a circle (radius scales with participant count, optimized for 2-8 people).
- Each participant rendered as a circle with their initial and first name below.
- Arrows are quadratic bezier curves with an offset so bidirectional edges don't overlap.
- Amount labels positioned at the midpoint of each curve.
- Uses Framer Motion `AnimatePresence` for enter/exit of edges and `motion.text` for amount morphing between steps.

**Styling**: Uses the app's design tokens -- `bg-primary` for active edges, `bg-muted` for inactive, `bg-success` for resolved edges, `bg-destructive/50` for fading edges.

### 7.6 `SimplificationViewer`

**File**: `src/components/settlement/simplification-viewer.tsx`

A paginated "book" component that displays the step-by-step simplification process.

**Props**:

```ts
interface SimplificationViewerProps {
  result: SimplificationResult;
  participants: User[];
}
```

**Structure**:
1. **Page indicator**: Dots or "Passo 2 de 5" text at the top.
2. **Graph area**: Renders `DebtGraph` with the edges for the current step.
3. **Description text**: Below the graph, shows what happened in this step (e.g., "Pedro paga R$ 45 para Ana — simplificado com divida existente").
4. **Navigation**: Left/right arrow buttons at the bottom. Also supports swipe gestures via touch event handlers (no library dependency -- raw `onTouchStart`/`onTouchEnd` with threshold).
5. **Summary footer on final page**: "Resultado: 5 transacoes simplificadas para 3".

**Transitions between pages**: When the page changes, edges animate:
- Edges present on both pages: amount label morphs via `layout` animation.
- Edges only on the previous page: fade out + scale down.
- Edges only on the next page: fade in + scale up.
- The highlighted "resolved" edge on intermediate pages pulses briefly before settling.

### 7.7 `SimplificationToggle`

**File**: `src/components/settlement/simplification-toggle.tsx`

A small inline component used in the bill detail payment tab.

**Props**:

```ts
interface SimplificationToggleProps {
  originalCount: number;
  simplifiedCount: number;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}
```

**Renders**: A `Switch` component (from `src/components/ui/switch.tsx`) with label text:
- Off state: "Simplificar dividas"
- On state: "Simplificado: 5 -> 3 transacoes" (with a Framer Motion number morph)

When toggled on, the parent component swaps the displayed ledger entries and shows a "Ver passo a passo" button that opens the `SimplificationViewer` in a `Sheet` (bottom drawer).

---

## 8. Existing file changes

### 8.1 `src/app/app/bill/new/page.tsx`

**Major changes**:

1. Add a `billType` state variable (or read from store after selection).
2. Before the wizard, render `BillTypeSelector` as a pre-step (or as step index 0).
3. Compute `steps` dynamically based on `billType`:

   **Itemized flow** (current + payer step):
   `type-select` -> `info` -> `participants` -> `items` -> `split` -> `payer` -> `summary`

   **Single-amount flow**:
   `type-select` -> `info` -> `participants` -> `amount-split` -> `payer` -> `summary`

4. The "info" step for single-amount bills hides the "Escanear nota fiscal" card and hides service fee / couvert fields (those are restaurant concepts).
5. Replace the `initBill` callback to pass `billType` to `createBill`.
6. Wire up `PayerStep` and `SingleAmountStep` in the step renderer.

### 8.2 `src/components/bill/bill-summary.tsx`

**Changes**:

1. Accept `payers: BillPayer[]` and `billSplits: BillSplit[]` as optional props.
2. Display a "Quem pagou" section above or below the current summary card, using `PayerSummaryCard`.
3. For single-amount bills, the "Por pessoa" breakdown reads from `billSplits` instead of `splits`.
4. For single-amount bills, hide the "Subtotal dos itens" and service fee lines. Show just "Total" and per-person shares.

### 8.3 `src/app/app/bill/[id]/page.tsx`

**Changes**:

1. Read `payers` from the store.
2. In the header card, show who paid (using `PayerSummaryCard` or inline text).
3. In the "items" tab, handle single-amount bills: show a single summary row instead of an item list.
4. Ledger entries now have `toUserId` pointing to potentially different payers, so the payment tab already handles this correctly (it looks up `receiver` by `entry.toUserId`).
5. **Simplification integration (phase 4)**: Add `SimplificationToggle` above the ledger entries list in the payment tab. Maintain local state `simplificationEnabled: boolean`. When enabled:
   - Call `simplifyDebts(ledger, participants)` to get `SimplificationResult`.
   - Display `result.simplifiedEdges` as ledger cards instead of the raw `ledger` entries.
   - Show "Ver passo a passo" button that opens a `Sheet` containing `SimplificationViewer`.
   - The simplified entries use the same payment card layout but with a subtle "simplificado" badge.

### 8.4 `src/types/index.ts`

See [section 5](#5-type-changes).

### 8.5 `src/stores/bill-store.ts`

See [section 6](#6-store-changes).

---

## 9. Wizard step order

### Pre-step: bill type selection

Not a numbered step in the progress bar. It's a full-screen selector that appears when the user taps "Nova conta." Once selected, the wizard begins with step 1.

### Itemized bill (restaurants)

| Step | Key | Label | Description |
|------|-----|-------|-------------|
| 1 | `info` | Dados | Title, merchant name, service fee %, couvert, scan NFC-e |
| 2 | `participants` | Pessoas | Add/remove participants |
| 3 | `items` | Itens | Add line items manually or from scan |
| 4 | `split` | Divisao | Assign items to participants |
| 5 | `payer` | Pagamento | Who paid the bill (new) |
| 6 | `summary` | Resumo | Review totals, per-person breakdown, who paid |

### Single-amount bill (Airbnb, Uber, etc.)

| Step | Key | Label | Description |
|------|-----|-------|-------------|
| 1 | `info` | Dados | Title only (no merchant, no service fee, no scan) |
| 2 | `participants` | Pessoas | Add/remove participants |
| 3 | `amount-split` | Divisao | Enter total amount, choose split method, assign shares |
| 4 | `payer` | Pagamento | Who paid the bill |
| 5 | `summary` | Resumo | Review totals, per-person breakdown, who paid |

### Rationale for payer step placement

The payer step comes after splitting because:
- The grand total must be known before the user can confirm who paid how much.
- For itemized bills, the total depends on items + fees.
- For single-amount bills, the total is entered in step 3.
- Multi-payer amounts must sum to the grand total, which requires the total to be finalized.

---

## 10. Ledger computation rewrite

### Current algorithm (to replace)

```
For each non-creator participant:
  debt = itemTotal + serviceFee + fixedFeeShare
  ledger entry: participant -> creator
```

### New algorithm

```
1. Compute each participant's consumption total:
   - Itemized: sum of their item splits + proportional service fee + equal fixed fee share
   - Single-amount: their billSplit.computedAmountCents

2. Compute each payer's payment:
   - From bill.payers array

3. Compute net balance for each participant:
   netBalance[userId] = paymentMade[userId] - consumptionTotal[userId]
   - Positive: others owe this person money (they overpaid relative to consumption)
   - Negative: this person owes money (they consumed more than they paid)

4. Generate minimal ledger entries:
   - Collect debtors (negative balance) and creditors (positive balance)
   - Sort debtors by amount ascending, creditors by amount descending
   - Greedy matching: pair largest debtor with largest creditor,
     transfer min(debtorOwes, creditorOwed), create ledger entry
   - Continue until all balances are zeroed

5. This naturally handles:
   - Single payer: payer has large positive balance, everyone else is negative
   - Multi-payer: multiple positive balances
   - Payer who also consumed: their payment offsets their consumption
   - Self-settlement: if a payer's payment equals their consumption, no entry needed
```

### Example: multi-payer

Bill total: R$ 300.00, three participants (A, B, C).
- A consumed R$ 120, B consumed R$ 100, C consumed R$ 80.
- A paid R$ 200, B paid R$ 100.

Net balances:
- A: +200 - 120 = +80 (owed R$ 80)
- B: +100 - 100 = 0 (settled)
- C: 0 - 80 = -80 (owes R$ 80)

Ledger: C -> A for R$ 80.00. B generates no entry.

### Example: single payer (common case)

Bill total: R$ 300.00, three participants (A, B, C). A paid everything.
- A consumed R$ 120, B consumed R$ 100, C consumed R$ 80.

Net balances:
- A: +300 - 120 = +180
- B: 0 - 100 = -100
- C: 0 - 80 = -80

Ledger: B -> A for R$ 100.00, C -> A for R$ 80.00.

Same result as current algorithm when payer is the creator.

---

## 11. Simplification algorithm

**File**: `src/lib/simplify.ts`

### Pure function signature

```ts
function simplifyDebts(
  edges: DebtEdge[],
  participants: User[],
): SimplificationResult
```

Takes the raw ledger edges (from `computeLedger`) and returns the full simplification result including all intermediate steps.

### Algorithm pseudocode

```
function simplifyDebts(edges, participants):
  // Step 0: compute net balances from raw edges
  balances = new Map<string, number>()
  for each edge in edges:
    balances[edge.fromUserId] -= edge.amountCents
    balances[edge.toUserId] += edge.amountCents

  steps = []
  steps.push({ balances: clone(balances), edges: clone(edges), description: "Dividas originais" })

  // Iteratively resolve
  creditors = entries where balance > 0, sorted descending
  debtors = entries where balance < 0, sorted ascending (most negative first)
  simplifiedEdges = []

  while creditors.length > 0 and debtors.length > 0:
    debtor = debtors[0]  // most negative
    creditor = creditors[0]  // most positive
    transfer = min(|debtor.balance|, creditor.balance)

    simplifiedEdges.push({ from: debtor.id, to: creditor.id, amount: transfer })
    balances[debtor.id] += transfer
    balances[creditor.id] -= transfer

    description = "{debtorName} paga {formatBRL(transfer)} para {creditorName}"

    // Remove zeroed-out participants
    if balances[debtor.id] == 0: remove from debtors
    if balances[creditor.id] == 0: remove from creditors

    steps.push({
      balances: clone(balances),
      edges: clone(simplifiedEdges),
      description
    })

  return {
    originalEdges: edges,
    steps,
    simplifiedEdges,
    originalCount: edges.length,
    simplifiedCount: simplifiedEdges.length,
  }
```

### Complexity

- Time: O(N log N) for sorting + O(N) for the greedy loop, where N is participant count.
- Space: O(N^2) worst case for storing intermediate steps with edge snapshots.
- For typical bill groups (2-8 people), this is trivial.

### Step recording details

Each step snapshot captures:
- The current balance map (who still owes/is owed what).
- The edges generated so far (cumulative).
- A human-readable description in pt-BR.

The visualization component walks through these snapshots one page at a time.

### Relationship to `computeLedger`

`computeLedger` (section 10) already uses the same greedy algorithm to produce minimal entries. The key difference:

| Concern | `computeLedger` | `simplifyDebts` |
|---------|-----------------|-----------------|
| Input | Per-participant consumption + payer amounts | Raw ledger entries from `computeLedger` |
| Output | `LedgerEntry[]` for the store | `SimplificationResult` with step history |
| Records steps | No | Yes |
| Used for | Generating the official ledger | Visualization and optional re-ordering |

In practice, when `computeLedger` already produces minimal entries (which it does with the new algorithm), `simplifyDebts` will show that no further simplification is possible. The value of the visualization is in *showing the work* -- users see the original debt relationships and how they collapse into fewer transfers.

For future multi-bill group balances (where debts from multiple bills accumulate), `simplifyDebts` becomes essential because cross-bill netting can reduce transactions further.

---

## 12. Edge cases and validation

### Payer validation

| Case | Behavior |
|------|----------|
| No payer selected | Block wizard progression. Show "Selecione quem pagou" |
| Payer amounts don't sum to grand total | Block progression. Show diff: "Faltam R$ X,XX" or "Excede R$ X,XX" |
| Payer is not a participant | Not possible -- payer list is drawn from participants |
| All participants paid equally for their own consumption | Ledger produces zero entries. Bill status goes directly to "settled" |

### Single-amount split validation

| Case | Behavior |
|------|----------|
| Percentages don't sum to 100% | Block progression. Show running sum |
| Fixed amounts don't sum to total | Block progression. Show diff |
| Equal split with remainder centavos | First N participants get +1 centavo (same as existing `splitItemEqually` logic) |
| Zero total entered | Block progression. Show "Informe o valor total" |

### Simplification validation

| Case | Behavior |
|------|----------|
| 0 or 1 ledger entries | Hide the toggle entirely (nothing to simplify) |
| Already minimal (no reduction possible) | Toggle still works, shows same count on both sides, step viewer shows single page |
| Circular debts (A->B, B->C, C->A) | Algorithm correctly nets to fewer edges |
| All balances zero after netting | No simplified edges, show "Todos liquidados" |
| Floating point drift in centavo math | All arithmetic is integer (centavos), no drift possible |

### Backward compatibility

| Concern | Solution |
|---------|----------|
| Existing bills without `billType` | Default to `"itemized"` |
| Existing bills without `payers` | Default to `[{ userId: creatorId, amountCents: grandTotal }]` |
| `BillSummary` receiving no `payers` prop | Compute default payer from `bill.creatorId` |

---

## 13. Implementation order

Work is split into four phases. Each phase produces a working state.

### Phase 1: types and store (no UI changes)

1. Add `BillType`, `BillPayer`, `BillSplit` to `src/types/index.ts`
2. Add `billType`, `totalAmountInput`, `payers` fields to `Bill` type
3. Add `payers` and `billSplits` state + actions to `src/stores/bill-store.ts`
4. Rewrite `computeLedger` with the net-balance algorithm
5. Update `getParticipantTotal` to handle both bill types
6. Update `recalcTotal` to handle single-amount bills
7. Verify: existing itemized flow still works (all debts flow to creator when payers defaults to `[{ creatorId, grandTotal }]`)

### Phase 2: payer step (feature 1)

1. Create `src/components/bill/payer-step.tsx`
2. Create `src/components/bill/payer-summary-card.tsx`
3. Add `"payer"` step to the wizard in `src/app/app/bill/new/page.tsx`
4. Update `BillSummary` to accept and display payers
5. Update `src/app/app/bill/[id]/page.tsx` to show payer info
6. Verify: single-payer and multi-payer scenarios produce correct ledger entries

### Phase 3: bill type selection (feature 2)

1. Create `src/components/bill/bill-type-selector.tsx`
2. Create `src/components/bill/single-amount-step.tsx`
3. Add type selection pre-step to `src/app/app/bill/new/page.tsx`
4. Make wizard steps dynamic based on `billType`
5. Conditionally hide service fee / couvert / scan fields for single-amount bills
6. Update `BillSummary` to handle single-amount display
7. Update bill detail page items tab for single-amount bills
8. Verify: single-amount equal/percentage/fixed splits produce correct ledger entries

### Phase 4: debt simplification (feature 3)

1. Implement `src/lib/simplify.ts` with `simplifyDebts` function and exported types
2. Write unit tests for the algorithm: 2-person, 3-person, circular debt, already-minimal cases
3. Create `src/components/settlement/debt-graph.tsx` (SVG ring layout + curved arrows)
4. Create `src/components/settlement/simplification-viewer.tsx` (paginated step book)
5. Create `src/components/settlement/simplification-toggle.tsx` (switch + transaction count)
6. Integrate into `src/app/app/bill/[id]/page.tsx`: add toggle to payment tab, wire up simplified ledger swap
7. Add `Sheet` (bottom drawer) that opens `SimplificationViewer` when "Ver passo a passo" is tapped
8. Verify: simplification produces correct results and visualization correctly animates through steps

---

## 14. Manual test checklist

### Payer feature

- [ ] Create itemized bill, default payer is creator, debts flow to creator
- [ ] Change payer to a different participant, debts flow to that person
- [ ] Set two payers with manual amounts summing to total, ledger entries distribute correctly
- [ ] Use "Pagou tudo" quick action, verify single payer set with full amount
- [ ] Use "Dividiu igualmente" quick action with 3 payers, verify amounts (handle remainder)
- [ ] Try to advance past payer step with amounts not summing to total, verify blocked
- [ ] Payer who consumed nothing still receives debts from others
- [ ] Payer whose payment equals their consumption produces no ledger entry for them

### Bill type selection

- [ ] "Nova conta" shows type selector before wizard
- [ ] Selecting "Valor unico" enters simplified wizard (no items/split steps)
- [ ] Selecting "Varios itens" enters full wizard (current flow + payer step)
- [ ] Single-amount bill: enter R$ 300, equal split among 3 people, verify R$ 100 each
- [ ] Single-amount bill: percentage split 50/30/20 on R$ 1000, verify R$ 500/300/200
- [ ] Single-amount bill: fixed split with custom amounts summing to total
- [ ] Single-amount bill: percentages not summing to 100% blocks progression
- [ ] Single-amount bill: info step hides service fee, couvert, and scan fields
- [ ] Bill detail page shows correct display for single-amount bills (no items tab content)
- [ ] Summary page shows split method info for single-amount bills

### Debt simplification

- [ ] Toggle "Simplificar dividas" appears on bill detail payment tab when ledger has 2+ entries
- [ ] Toggle is hidden when ledger has 0 or 1 entries (nothing to simplify)
- [ ] Toggling on shows simplified transaction count: "N transacoes -> M transacoes"
- [ ] Toggling on swaps displayed ledger entries to simplified versions
- [ ] Toggling off restores original ledger entries
- [ ] "Ver passo a passo" opens bottom sheet with SimplificationViewer
- [ ] Page 1 shows original debt graph with all edges
- [ ] Intermediate pages show step description and cumulative simplified edges
- [ ] Final page shows only the simplified edges
- [ ] Left/right arrows navigate between pages
- [ ] Swipe gestures navigate between pages on mobile
- [ ] Animations: edges fade in/out, amounts morph between steps
- [ ] 2-person bill: simplification produces same single edge (no improvement)
- [ ] 3-person circular debt (A->B R$50, B->C R$50, C->A R$30): correctly nets to 2 edges
- [ ] Already-minimal ledger: toggle shows "Ja simplificado" or same count on both sides

### Combined scenarios

- [ ] Single-amount bill with multi-payer: R$ 600 split equally among 3, paid by 2 people (R$ 300 each). Verify only the non-payer has a debt entry.
- [ ] Itemized bill where one participant paid but consumed nothing. Verify all others owe that person.
- [ ] Multi-payer itemized bill with 5 participants, simplification reduces 4 entries to 3.

---

## Files touched (summary)

| File | Change type | Phase |
|------|------------|-------|
| `src/types/index.ts` | Modified -- add `BillType`, `BillPayer`, `BillSplit`, update `Bill` | 1 |
| `src/stores/bill-store.ts` | Modified -- new state, actions, rewritten `computeLedger` | 1 |
| `src/components/bill/payer-step.tsx` | **New** | 2 |
| `src/components/bill/payer-summary-card.tsx` | **New** | 2 |
| `src/app/app/bill/new/page.tsx` | Modified -- type selector pre-step, dynamic steps, payer step | 2, 3 |
| `src/components/bill/bill-summary.tsx` | Modified -- payer display, single-amount support | 2, 3 |
| `src/app/app/bill/[id]/page.tsx` | Modified -- payer info, single-amount items tab, simplification toggle | 2, 3, 4 |
| `src/components/bill/bill-type-selector.tsx` | **New** | 3 |
| `src/components/bill/single-amount-step.tsx` | **New** | 3 |
| `src/lib/simplify.ts` | **New** -- algorithm + types | 4 |
| `src/components/settlement/debt-graph.tsx` | **New** -- SVG graph renderer | 4 |
| `src/components/settlement/simplification-viewer.tsx` | **New** -- paginated step viewer | 4 |
| `src/components/settlement/simplification-toggle.tsx` | **New** -- switch component | 4 |

---

## Open questions

1. **Database migration**: The current Supabase schema (`docs/2026-03-23-pixwise-architecture.md`) has no `payers` or `bill_type` column on `bills`. A migration will be needed when moving from client-side store to Supabase persistence. Out of scope for this plan (store-only for now).
2. **Receipt scan interaction**: For single-amount bills, scanning an NFC-e receipt should probably auto-switch to itemized mode and populate items. Deferred to a follow-up.
3. **Tip handling**: Some groups tip separately from the bill. Currently modeled as `serviceFeePercent`. No change planned, but worth noting that tip and service fee are conceptually different in Brazil (gorjeta vs taxa de servico).
4. **Multi-bill simplification**: The current `simplifyDebts` function operates on a single bill's ledger. A future version could operate across multiple bills in a group, netting debts from "Pedro owes Ana R$ 30 from dinner" and "Ana owes Pedro R$ 20 from Uber" into a single R$ 10 transfer. The algorithm is identical -- just the input edges span multiple bills. Deferred.
5. **Graph layout for large groups**: The circular layout works for 2-8 people. For groups of 10+, edges become dense and labels overlap. If we support large groups in the future, consider a force-directed layout or a simplified list view as an alternative to the graph.
