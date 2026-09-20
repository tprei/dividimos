# Testing Guide

Dividimos has three layers of automated tests: **unit**, **integration**, and **synthetic (E2E)**, alongside a mandatory **credentialed acceptance layer** for physical device hardware, native OS bridges, and live third-party cloud providers. Each layer has a specific purpose — avoid duplicating coverage across layers.

## Unit Tests

Fast, isolated tests for pure logic and component rendering. Run in Vitest with happy-dom.

```bash
npm run test            # run once
npm run test:watch      # watch mode
```

**What to test here:** currency math, debt simplification, Pix EMV encoding, component rendering, store logic.

**What NOT to test here:** database queries, RLS policies, auth flows, multi-user interactions.

## Integration Tests

Test the ledger RPC layer against a real local Supabase instance. Verify membership checks, optimistic concurrency, balance recomputation, and constraint enforcement. The suites live next to the code they exercise, in `src/lib/ledger/`: `rpc-read`, `rpc-expense`, `rpc-settlement`, `rpc-group`, `rpc-guest`, `rpc-nudge`, and `transfers` (SQL↔TypeScript parity for `group_transfers`/`transfersFromBalances` over 200 random ledgers) — 131 tests in total. SQL behavior is covered entirely by these TypeScript suites.

```bash
supabase db reset --local
npm run test:integration
```

**What to test here:** RPC behavior (`create_expense`, `edit_expense` and its `stale_version` guard, `delete_expense`/`restore_expense`, `record_settlement`, `group_transfers`, `send_nudge`, `claim_guest`), `recompute_group_balances` correctness after each mutation, zero-policy RLS (tables reject direct access from `anon`/`authenticated`), realtime authorization, and constraint enforcement.

**What NOT to test here:** UI rendering, browser navigation, multi-step user journeys.

Suites use `src/test/integration-helpers.ts` — `createTestUser`, `createTestUsers`, `authenticateAs`, `createGroup`, `createGroupWithMembers`, `createExpense`, plus `withPg` for direct `pg` setup (seeding balances, asserting rows) and `expectRpcError` for error-code assertions. Wrap suites in `describe.skipIf(!isIntegrationTestReady)` so they skip when env vars are absent.

### Migration verification

The ordered files in `supabase/migrations/` are the database source of truth. `supabase db reset --local` destroys the local database and replays that directory in order. Migration changes must pass the fresh replay, trusted-epoch comparison, generated-type equality, integration contract suite, and database security invariant checks in `.github/workflows/migrations.yml`. Do not edit, rename, or delete a migration that has landed on `main` or was applied to a shared database.

## Synthetic Tests (E2E)

Self-contained Playwright tests that verify end-to-end user journeys through the real UI, API routes, auth, and database working together. Each test seeds its own users and data — no shared state, no ordering dependencies.

### Why "synthetic"?

Unlike traditional E2E tests that rely on pre-seeded shared users (alice/bob/carol), synthetic tests create fresh, isolated test data per test case via the `SeedHelper` class. This makes them:

- **Deterministic** — no flaky failures from leftover state
- **Independent** — run in any order, skip any test
- **Self-cleaning** — fixture teardown removes all seeded data, even on failure

### Running synthetic tests

Prerequisites: local Supabase running + dev server (auto-started by Playwright if not in CI).

```bash
# Run all synthetic tests
npm run test:synthetic

# With visible browser
npm run test:synthetic:headed

# Interactive UI mode (pause, inspect, step through)
npm run test:synthetic:ui

# Run all E2E tests (flow tests + synthetic)
npm run test:e2e

# Same suite on mobile engines: iPhone 13 (WebKit) and Pixel 5 (mobile Chromium)
npm run test:synthetic:mobile
npm run test:synthetic:ios
npm run test:synthetic:android
```

The mobile projects need WebKit installed once: `npx playwright install --with-deps chromium webkit`. CI runs all three projects as a matrix axis.

A second actor inside a synthetic test must come from the `newSession` fixture, not `browser.newContext()`. The raw call drops the project's device profile, so on the iPhone project every actor except the first would silently run at a desktop viewport.

### What browser projects cannot prove

WebKit catches engine and layout regressions. It does not exercise the iOS keyboard accessory bar, Add to Home Screen / standalone mode, native permission prompts, or the native camera UI. Before a release, accept those by hand:

- iPhone Safari, then the same flows after Add to Home Screen: register a payment with the keyboard open, add a guest, open the receipt camera.
- Android Chrome and the installed PWA: the same three flows.
- The Capacitor WebView on a device or emulator (`npm run cap:dev:android`, or `scripts/cap-dev.sh android --device --run`): keyboard resize, back gesture, native camera and gallery.

Native iOS parity stays a future macOS/Xcode task. Browser CI is not evidence for it.

### Architecture

```
e2e/
├── fixtures.ts              # Custom Playwright fixtures (adminClient, seed, loginAs)
├── seed-helper.ts           # SeedHelper class — creates users, groups, expenses via admin API
├── auth.setup.ts            # Session setup for legacy flow tests (not used by synthetic)
├── flows/                   # Legacy flow tests (shared alice/bob/carol sessions)
└── synthetic/               # Synthetic tests (self-contained, isolated data)
    ├── expense-lifecycle.spec.ts
    ├── group-invite-accept.spec.ts
    └── settlement-flow.spec.ts
```

### Writing a synthetic test

```typescript
import { test, expect } from "../fixtures";

test("user can see their group", async ({ page, seed, loginAs }) => {
  // 1. Seed test data — each test creates its own users and groups
  const alice = await seed.createUser({ handle: "alice" });
  const bob = await seed.createUser({ handle: "bob" });
  const group = await seed.createGroup(alice.id, [bob.id], "Almoço");

  // 2. Authenticate as a seeded user (sets session cookies directly)
  await loginAs(alice);

  // 3. Interact with the UI and assert
  await page.goto(`/app/groups/${group.id}`);
  await expect(page.getByText("Almoço")).toBeVisible();

  // Cleanup runs automatically in fixture teardown — no manual cleanup needed
});
```

### Key fixtures

| Fixture | Description |
|---------|-------------|
| `adminClient` | Supabase client with service role key. Bypasses RLS for test setup. |
| `seed` | `SeedHelper` instance. Create users, groups, expenses. Auto-cleans up after test. |
| `loginAs(user)` | Authenticate the browser by setting Supabase session cookies directly from the seeded user's tokens. |

### SeedHelper methods

| Method | Description |
|--------|-------------|
| `createUser(options)` | Create an auth user + profile. Returns `SeededUser` with tokens. |
| `createUsers(count, baseOptions)` | Create multiple users in parallel. |
| `createGroup(creatorId, memberIds, name)` | Create group with all members accepted. |
| `createExpense(groupId, creatorId, participantIds, options)` | Create an active expense (updates balances). |
| `createExpenseWithSettlements(...)` | Create an expense and record one settlement per payable edge (balances clear). |
| `authenticateAs(userId)` | Generate a fresh session for RPC calls. |
| `cleanup()` | Delete all tracked entities in dependency order. Called automatically. |

### Multi-user testing

To test interactions between two users (e.g., Alice creates, Bob views), use separate browser contexts with the `loginInContext` helper:

```typescript
import { test, expect, loginInContext } from "../fixtures";

test("bob sees alice's expense", async ({ page, seed, loginAs, browser }) => {
  const alice = await seed.createUser({ handle: "alice" });
  const bob = await seed.createUser({ handle: "bob" });
  const group = await seed.createGroup(alice.id, [bob.id]);

  await seed.createExpense(group.id, alice.id, [alice.id, bob.id]);

  // Alice's view
  await loginAs(alice);
  await page.goto(`/app/groups/${group.id}`);
  await expect(page.getByText("Ativo")).toBeVisible();

  // Bob's view — separate browser context
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await loginInContext(bobContext, bobPage, bob);

  await bobPage.goto(`/app/groups/${group.id}`);
  await expect(bobPage.getByText("Ativo")).toBeVisible();

  await bobContext.close();
});
```

### Cleanup guarantees

The `seed` fixture calls `cleanup()` after every test, even if the test fails. Cleanup deletes entities in reverse dependency order:

1. Settlements
2. Expense child rows (payers, shares, items) → balances → expenses
3. Group members → groups
4. Public users → auth users

This prevents data accumulation across test runs. If a test is interrupted (e.g., process killed), orphaned data may remain — run `supabase db reset` to restore a clean state.

### What to test synthetically

- Cross-cutting user journeys (UI + API + auth + database)
- Multi-user interactions (invite/accept, settle debts)
- Status transitions visible in the UI (active ⇄ deleted)
- Navigation flows and page state after actions

### What NOT to test synthetically

- RLS policies — covered by integration tests
- RPC atomicity — covered by integration tests
- Component rendering in isolation — covered by unit tests
- Pure algorithms (simplification, Pix encoding) — covered by unit tests


## Credentialed Acceptance Scenarios (Web & Android)

Dividimos integrates with native mobile operating system capabilities (Android via Capacitor) and third-party cloud services (Google OAuth, Google Cloud Vertex / Gemini 2.5 Flash, Firebase Cloud Messaging, and Web Push).

Automated unit, integration, and synthetic tests mock these boundaries for execution speed, deterministic CI runs, and developer isolation. However, **mocked tests never count as live-provider proof**.

### Scaffold Tests Replacement & Acceptance Policy

- **Scaffold Tests Replaced**: The default Android template tests (`android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java` and `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java`, which merely assert `2 + 2 = 4` and check package naming) do not exercise real device capabilities, runtime permissions, OAuth handshakes, or live external providers. They are superseded by the credentialed acceptance scenarios defined below.
- **Missing Accounts, Devices, or Credentials BLOCK Acceptance**: Missing physical Android hardware, test accounts, Firebase project credentials, or provider API keys **BLOCK** release acceptance. They cannot be bypassed, marked as passed, or deferred without an explicit human sign-off recorded on the PR.
- **Provider Output Non-Determinism**: Generative AI models (Gemini 2.5 Flash for receipt OCR and voice expense parsing) produce non-deterministic phrasing, varied tokenization, and whitespace differences across requests. Acceptance criteria must **never** assert exact provider wording or rigid text templates. Tests verify schema conformance, valid numeric amounts, mathematical reconciliation, and that candidate values appear in the UI for user review.
- **Pre-Cutover Run Recording**: Verification results must be recorded directly in the pull request description using the acceptance table format (`Scenario`, `Date`, `Result`, `Environment`, `Notes`). Scenarios requiring production-only secrets or specific physical hardware supplied by the maintainer are flagged as release prerequisites rather than claimed.

---

### Scenario 1: Google Sign-In with a Real Account

Tests live Google authentication across both the web OAuth redirect flow and Android native Google Credential Manager.

- **Surfaces & File Paths**:
  - Web: `src/app/auth/page.tsx` (`signInWithOAuth({ provider: "google" })`), `/auth/callback`, `/auth/continue`
  - Android native: `src/lib/capacitor/auth.ts` (`nativeGoogleSignIn` via `@capgo/capacitor-social-login`, `supabase.auth.signInWithIdToken`), `android/app/build.gradle`
- **Prerequisites**:
  - A real Google account with active credentials.
  - Web: Supabase Google OAuth configured with valid client ID and client secret, with callback URL whitelisted (`http://localhost:3000/auth/callback` or production domain).
  - Android: Physical Android device or emulator with Google Play Services; debug or release APK built with `android/app/google-services.json` and matching SHA-1 certificate fingerprint registered in Google Cloud Console.
- **Exact Manual Steps**:
  - **Web Flow**:
    1. Open `/auth` in a clean browser session (incognito or signed out).
    2. Click the **"Continuar com Google"** button.
    3. Verify browser redirects to Google's account selection / consent screen (`accounts.google.com`).
    4. Select the Google account and grant permissions.
    5. Verify redirection back through `/auth/callback?next=...` and landing at `/app` (or `/onboarding` for a newly created user).
  - **Android Flow**:
    1. Launch the Dividimos APK on an Android device configured with a Google account.
    2. Tap **"Continuar com Google"** on the authentication screen.
    3. Observe the native Android Google Credential Manager bottom sheet listing device accounts.
    4. Select the Google account.
    5. Observe token exchange via `supabase.auth.signInWithIdToken`, dismissal of the native bottom sheet, automatic navigation through `/auth/continue`, and arrival at `/app`.
- **Expected Observable Outcomes**:
  - User session is established in Supabase Auth with valid JWT.
  - User profile is hydrated into `useAppStore` (`me` object populated).
  - Profile avatar, name, and email match the Google account in `/app/settings`.
  - Network error or cancelled bottom sheet displays user-friendly Portuguese error toast (`"Não foi possível entrar com Google. Tente novamente."` or `"Erro ao conectar com Google. Verifique sua conexão."`) without unhandled crashes.

---

### Scenario 2: Camera and Gallery Receipt Capture

Tests native camera capture, photo gallery selection, and web file upload fallbacks for bill receipts.

- **Surfaces & File Paths**:
  - UI: `src/components/bill/receipt-scanner.tsx` (mode selector, capture buttons, image preview)
  - Native Bridge: `src/lib/capacitor/camera.ts` (`takeNativePhoto`, `pickNativeGalleryPhoto` via `@capacitor/camera`)
  - Entry points: `src/components/bill/bill-type-selector.tsx`, `src/app/app/bill/new/page.tsx`
  - Shimmer feedback: `src/components/bill/scan-skeleton-loader.tsx`
- **Prerequisites**:
  - Physical Android device with functional camera hardware and storage access.
  - Web browser with file input / camera capture support.
  - Test receipt image (physical printed Brazilian cupom fiscal or clear image file).
  - Backend server with valid `GEMINI_API_KEY`.
- **Exact Manual Steps**:
  1. Navigate to `/app/bill/new` (or tap "Nova despesa" within any group).
  2. Select **"Escanear nota"** (Camera icon).
  3. **Android Native Path**:
     - Tap **"Camera"** ("Tirar foto agora"):
       - On first launch, verify Android OS displays the runtime camera permission prompt (`android.permission.CAMERA`).
       - If permission is denied, verify red alert appears: `"Permita o acesso à câmera nas configurações do aparelho."`.
       - Re-enable permission in Android settings, tap "Camera", align the receipt within the viewfinder, and take the picture.
     - Alternatively, tap **"Galeria"** ("Escolher foto"):
       - Verify native Android photo picker opens.
       - Select an existing receipt image.
  4. **Web Browser Path**:
     - Tap **"Camera"** to invoke device camera capture (`capture="environment"`), or **"Galeria"** to trigger the file picker.
     - Select a JPEG or PNG receipt image.
  5. Verify captured/selected image displays in the preview container with buttons **"Trocar foto"** and **"Processar nota"**.
  6. Tap **"Processar nota"**:
     - Verify transition to `ScanSkeletonLoader` ("Lendo nota fiscal...").
     - Verify image compression occurs client-side (`src/lib/process-receipt-scan.ts`) and uploads to `/api/receipt/ocr`.
- **Expected Observable Outcomes**:
  - Native camera launches smoothly and saves captured image to app cache.
  - Permission denial triggers clear in-app guidance without freezing the interface.
  - Photo preview renders with accurate aspect ratio.
  - Shimmer loading state displays while OCR executes, followed by seamless transition to review.

---

### Scenario 3: Contacts Permission and WhatsApp Invite Flow

Tests the Android address book permission lifecycle (deny, allow) and contact invitation dispatch.

- **Surfaces & File Paths**:
  - Detection: `src/lib/contacts.ts` (`isContactPickerSupported`, `pickContacts`)
  - Android Native Bridge: `src/lib/capacitor/contacts.ts` (`pickNativeContact` via `@capacitor-community/contacts`)
  - Invite Modal: `src/components/group/group-invite-modal.tsx`
  - Contact List Component: `src/components/group/group-invite-contacts.tsx` (`InviteContactsList`)
- **Prerequisites**:
  - Android device with phonebook containing contacts with Brazilian phone numbers (`+55...`).
  - WhatsApp installed or accessible via browser.
  - Authenticated user inside an existing group.
- **Exact Manual Steps**:
  - **Sub-scenario 3A: Permission Denied**:
    1. Open group details (`/app/groups/[id]`) and tap **"Convidar"** to open `GroupInviteModal`.
    2. Tap **"Escolher dos contatos"** (`Users` icon).
    3. When the Android OS permission dialog appears (`android.permission.READ_CONTACTS`), tap **"Não permitir"** (Deny).
    4. Observe error toast: `"Permissão de contatos negada. Verifique as configurações do app."` (or in bill wizard: `"Permita o acesso aos contatos nas configurações do aparelho."`).
    5. Verify modal remains functional and does not crash or lock up.
  - **Sub-scenario 3B: Permission Allowed & Contact Selection**:
    1. Tap **"Escolher dos contatos"** again (or grant permission in OS App Settings and retry).
    2. Tap **"Permitir"** (Allow) on the system dialog.
    3. Observe the native contact picker dialog opening.
    4. Select a contact with a valid mobile phone number.
    5. Verify contact is added to the in-modal list showing contact name and normalized phone format.
  - **Sub-scenario 3C: WhatsApp Invite Dispatch**:
    1. Tap the green **"Enviar"** button next to the contact (or **"Enviar para todos"**).
    2. Verify WhatsApp opens with a pre-filled invitation message containing the group name and unique join URL (`buildWhatsAppLink`).
    3. Switch back to Dividimos.
    4. Verify the contact row displays a green checkmark icon (`Check`) and text **"Aberto"**.
- **Expected Observable Outcomes**:
  - Denial is intercepted gracefully with clear user feedback.
  - Grant launches native picker; contact name and telephone are correctly extracted and normalized via `normalizeBrazilianPhone`.
  - WhatsApp link composition works reliably; contact row reflects dispatched status.

---

### Scenario 4: Speech Input Flow

Tests voice expense capture, microphone permissions, speech-to-text streaming, and Gemini natural language parsing.

- **Surfaces & File Paths**:
  - Web Speech API hook: `src/hooks/use-voice-input.ts` (`SpeechRecognition` / `webkitSpeechRecognition`)
  - Android Native Speech: `src/lib/capacitor/speech.ts` (`startNativeListening` via `@capgo/capacitor-speech-recognition`)
  - UI Button: `src/components/bill/voice-expense-button.tsx`
  - Review Modal: `src/components/bill/voice-expense-modal.tsx` (`VoiceExpenseModal`)
  - API Route: `src/app/api/voice/parse/route.ts`
  - Parser: `src/lib/voice-expense-parser.ts`
- **Prerequisites**:
  - Physical device or workstation with functioning microphone hardware.
  - Microphone permissions available.
  - Valid `GEMINI_API_KEY` configured on backend.
  - Group with existing member handles for participant matching.
- **Exact Manual Steps**:
  1. In `/app/bill/new` (or from group expenses), tap **"Falar despesa"** (Mic icon).
  2. Verify microphone button displays **"Toque pra falar"**.
  3. Tap the microphone button.
  4. **Permission Test**:
     - If prompted for microphone permission (`RECORD_AUDIO` on Android, browser prompt on web), deny once to observe `"Permissão do microfone negada."`.
     - Grant permission and tap again.
  5. Verify listening state activates: button text displays **"Toque pra parar"** with pulsing recording indicator.
  6. Speak naturally in Brazilian Portuguese, e.g.:
     `"Almoço no restaurante 85 reais pago por mim dividido com Lucas"`
     or
     `"Padaria 42 reais"`
  7. Observe interim transcript streaming in real-time beneath the button.
  8. Tap **"Toque pra parar"** (or allow silence detection to automatically stop).
  9. Observe request sent to `/api/voice/parse` and response handled.
  10. Observe `VoiceExpenseModal` opening:
      - Title parsed (e.g. "Almoço no restaurante").
      - Amount parsed into Brazilian Real (e.g. "R$ 85,00").
      - Expense type categorized (single amount vs itemized).
      - Participants attributed (or highlighted with warning `"Atribua todos os participantes antes de confirmar"` if confidence is low).
  11. Edit title or amount if necessary, and tap **"Confirmar"**.
- **Expected Observable Outcomes**:
  - Real-time Portuguese speech-to-text transcript displays during recording.
  - Gemini parses expense parameters accurately from unstructured voice command.
  - `VoiceExpenseModal` allows human review and manual override before hydrating into store.

---

### Scenario 5: AI / OCR Provider Results Reviewed Before Saving

Tests that Gemini receipt OCR output is treated strictly as an untrusted draft requiring human verification and correction before any ledger database mutation.

- **Surfaces & File Paths**:
  - API Route: `src/app/api/receipt/ocr/route.ts`
  - OCR Logic: `src/lib/receipt-ocr.ts` (`parseReceiptImage` via `@google/genai` Gemini 2.5 Flash)
  - Validation & Deadline: `src/lib/process-receipt-scan.ts` (`assertReconciledReceipt`)
  - Review Screen: `src/components/bill/scanned-items-review.tsx` (`ScannedItemsReview`)
  - Item Row Editor: `src/components/bill/receipt/receipt-item-row.tsx` (`ReceiptItemRow`)
  - Persistence Boundary: `src/app/app/bill/new/use-wizard-submit.ts`, `src/lib/ledger/rpc-expense.ts` (`createExpense`)
- **Prerequisites**:
  - Printed or digital receipt image containing multiple line items, subtotal, and optional service fee.
  - Valid `GEMINI_API_KEY`.
  - Authenticated session in Dividimos.
- **Exact Manual Steps**:
  1. Capture or select receipt photo via **"Escanear nota"** and tap **"Processar nota"**.
  2. Wait for OCR processing to complete; observe arrival at the `ScannedItemsReview` screen.
  3. Verify all candidate data rendered in editable controls:
     - Merchant title in editable input field.
     - Occurrence date in `DateField` (defaults to receipt date or today).
     - Individual line items in `ReceiptItemRow` list, each with editable name and amount fields.
     - Service fee percentage input (`#receipt-service-fee`).
     - Subtotal, service fee calculation, and fee-inclusive total in `Money` summary.
  4. Perform interactive edits:
     - Change an item's description text.
     - Adjust an item's amount; verify subtotal and total update immediately.
     - Delete an unwanted line item via the trash icon; verify total recalculates.
     - Tap **"Adicionar item"** to append a new item with name and price.
     - Modify service fee percentage (e.g., from 10% to 0% or 15%); verify fee recalculation.
  5. **Inspect Persistence Boundary**:
     - Check network traffic and database state: confirm that **zero** rows have been inserted into `expenses`, `expense_versions`, or `expense_splits`. The OCR output exists purely in client memory.
  6. Tap **"Avançar"**:
     - Verify transition to participant split assignment (`ItemizedBillForm`).
     - Assign items to group members.
  7. Tap **"Criar despesa"** (or "Salvar"):
     - Verify `createExpense` RPC executes, committing the validated, human-reviewed expense to the database.
- **Expected Observable Outcomes**:
  - OCR candidate data is completely editable before commitment.
  - Generative non-determinism does not break processing; arithmetic reconciliation is enforced.
  - Database persistence occurs only after explicit human confirmation and split assignment.

---

### Scenario 6: Push Notification Delivery and Deep Linking

Tests end-to-end push notification delivery via Firebase Cloud Messaging (FCM) on a physical Android device and Web Push in desktop browsers.

- **Surfaces & File Paths**:
  - Native Push Registration: `src/lib/push/native-registration.ts` (`PushNotifications.register`)
  - Native Push Subscription Route: `src/app/api/push/subscribe/native/route.ts`
  - Web Push Subscription Route: `src/app/api/push/subscribe/route.ts`
  - Push Hook: `src/hooks/use-push-notifications.ts` (`usePushNotifications`)
  - Notification Routing & Action: `src/components/app-shell.tsx` (`PushNotifications.addListener("pushNotificationActionPerformed")`)
  - Android Manifest & Notification Icon: `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/drawable/ic_stat_notification.xml`
  - Backend FCM Dispatch: `src/lib/push/fcm.ts`
- **Prerequisites**:
  - Physical Android device running Android 13+ with Google Play Services (emulators often fail FCM token generation or drop background notifications).
  - Built debug or signed release APK containing valid `android/app/google-services.json`.
  - Server configured with `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` (and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for web push).
  - Two distinct user accounts: User A (recipient on physical Android) and User B (sender).
- **Exact Manual Steps**:
  1. On the physical Android device, sign in as User A.
  2. Navigate to `/app/settings` (or respond to the in-app notification prompt).
  3. Toggle **"Notificações push"** ON.
  4. On Android 13+, observe OS prompt: `"Permitir que o app Dividimos envie notificações?"`. Tap **"Permitir"** (Allow).
  5. Confirm toggle displays enabled. In developer logs, verify `PushNotifications.addListener("registration")` fired and POSTed the FCM device token to `/api/push/subscribe/native`.
  6. Place the Dividimos app on User A's device into the background (press Home or lock the screen).
  7. On User B's device (or web browser), perform an action that triggers a notification for User A (e.g. record an expense involving User A, send a nudge, or record a settlement).
  8. On User A's physical Android device, observe:
     - Notification sound and/or vibration triggers.
     - Android status bar displays the Dividimos white silhouette icon (`ic_stat_notification`).
     - System notification shade displays the notification title, message body, and time.
  9. Tap the notification in the Android system shade.
  10. Observe Dividimos brings itself to the foreground and `pushNotificationActionPerformed` routes directly to the target group or expense URL.
- **Expected Observable Outcomes**:
  - FCM device token is registered and persisted in the database for User A.
  - Notification arrives reliably over the air on physical hardware while app is backgrounded.
  - Notification tap deep-links to the referenced resource.
## CI

All three test layers run in GitHub Actions on push to `main` and on pull requests:

| Workflow | File | What it runs |
|----------|------|-------------|
| CI | `.github/workflows/ci.yml` | Unit tests, type check, lint |
| Integration | `.github/workflows/integration.yml` | Integration tests against local Supabase |
| Synthetic | `.github/workflows/synthetic.yml` | Synthetic E2E tests against local Supabase + dev server |

## Environment variables

All test layers need these (set by `./scripts/dev-setup.sh` or `supabase start`):

| Variable | Required by |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Integration, Synthetic |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Integration, Synthetic |
| `SUPABASE_SERVICE_ROLE_KEY` | Integration, Synthetic |
| `PIX_ENCRYPTION_KEY` | Integration |
| `SUPABASE_DB_URL` | Integration (test-runner Postgres credential for the direct `pg` connections used by `withPg` and by test-data cleanup; not an application environment setting) |
| `RATE_LIMIT_DISABLED` | Integration (set to `0` in CI; the limiter wrapper's non-production Vitest-only bypass reads this, but a suite-wide `1` would make rate-limit enforcement tests false-green) |
| `E2E_BASE_URL` | Synthetic (defaults to `http://localhost:3000`) |
| `GEMINI_API_KEY` | Credentialed Acceptance (live Gemini OCR and voice expense parsing) |
| `FCM_PROJECT_ID` | Credentialed Acceptance (Android native push via Firebase Cloud Messaging) |
| `FCM_CLIENT_EMAIL` | Credentialed Acceptance (FCM v1 service account email) |
| `FCM_PRIVATE_KEY` | Credentialed Acceptance (FCM v1 service account private key) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Credentialed Acceptance (Web Push VAPID public key) |
| `VAPID_PRIVATE_KEY` | Credentialed Acceptance (Web Push VAPID private key) |
| `VAPID_SUBJECT` | Credentialed Acceptance (Web Push contact URI) |
