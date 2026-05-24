# Deep Bug Hunt — Pixwise / Dividimos

**Date:** 2026-05-18
**Method:** 30 adversarial enemy subagents across 2 waves, plus PR-level re-review of #442–#450.
**State assumed:** PRs #442–#450 merged with the recommended revisions from the PR-review addendum (`docs/deep-bug-hunt-pr-review-2026-05-18.md`). All findings below are what remains open after that batch lands.

## TL;DR — priority order

1. **`/api/dev/login` is shippable to non-prod environments.** `NEXT_PUBLIC_DEV_LOGIN_ENABLED` bakes into the client bundle; `dev-setup.sh` defaults to `true`; synthetic CI runs `npm run build` (production build) with the flag set; route echoes session cookies in the response body and interpolates raw Supabase admin errors. Account takeover by email is one curl away if the artifact ever ships. **Fix:** drop the `NEXT_PUBLIC_` flag, gate on `NODE_ENV === "development"` server-side only, add a `@test.dividimos.local` email allowlist, stop returning cookies in the response body, sanitize error messages.
2. **`/u/[handle]` leaks user data to unauthenticated visitors.** The page uses `createAdminClient()` to bypass RLS and returns `id`, `name`, and Google `avatar_url` for any handle. PR #444 fixed the runtime 500 that was masking this, so the leak is now reachable on every request. Combined with `lookup_user_by_handle` having no rate limit (D8-C4), full handle enumeration is trivial. **Fix:** route both surfaces through a single `get_public_profile(handle)` SECURITY DEFINER RPC, drop `id`/`avatar_url` from the unauthenticated payload, wire `enforceRateLimit` (#445 infra) once it lands.
3. **Pix BR Code is malformed for real users.** TLV length encoding overflows at value length ≥100 bytes (e.g., realistic long email keys); `value.length` counts UTF-16 code units while EMV requires UTF-8 byte count. Banking apps reject. CRC computed via `charCodeAt` rather than UTF-8 bytes compounds the problem.
4. **`/api/pix/generate` has no debt-link check.** Any accepted group member can mint a R$100k QR code for any other member's Pix key with no rate limit. Server-blessed phishing primitive. PR #445 infra is ready but the wire-up PRs (2/3) haven't landed.
5. **System message forgery via direct INSERT.** `chat_messages_insert` policy doesn't gate on `message_type` — any user can insert `system_settlement` rows with arbitrary content. The April audit migration patched UPDATE only. Worse: `chat-messages.integration.test.ts:83-98` asserts this forgery is allowed.
6. **`/api/push/send` is a notification injection endpoint.** Caller-supplied title/body/url, no preference check, no rate limit, no length cap. Combined with #5, an attacker can plant a fake "Confirme R$ 5.000" push that points at a real in-app action. #445 infra ready, wire-up pending.
7. **Kick is not authoritative.** Three independent ways for a kicked user to rejoin: stale invite link, direct re-invite by any co-member (single `INSERT` through RLS), guest claim. Test `invite-link-guards.integration.test.ts:138-156` asserts and locks in this buggy behavior.
8. **Single `PIX_ENCRYPTION_KEY` encrypts everything.** Pix keys + FCM tokens + web push subscriptions all share one key with no versioning. Rotating it silently deletes every user's push subscriptions on the next notify pass, because `notify-user.ts` treats decryption failure as "stale".
9. **`saveExpenseDraft` is not transactional.** Five separate PostgREST deletes + parallel inserts can be interleaved with `activate_expense` (which only locks `expenses`, not the child tables). Result: permanently-active expense with zero balance writes. No recovery — the expense can no longer be edited or activated.
10. **Pending-settlement reversal post-leave.** `settlements_insert` still allows direct pending-status insert; `confirm_settlement` validates creditor membership but not debtor's. A debtor can INSERT a pending settlement, run `record_and_settle` (balance → 0), then `leave_group`, then the creditor confirms the pending row → balance goes negative, ex-member ends up "owed" money.

---

## Recently closed (PRs #442–#450, with revisions)

Tracked so we don't re-flag:

- ✅ **D1-C1 global ledger invariant** and **D1-H3 deadlock** — fixed by #442 (`activate_expense` aggregates exact NUMERIC per pair, rounds once, deterministic `ORDER BY`). Per-user drift is a documented residual (see "Acknowledged tradeoffs").
- ✅ **W2-7 C1 demo phishing primitive** — `DEMO_PIX_KEYS` now uses RFC 2606 `.invalid` TLD; demo page has `robots: noindex` + `X-Frame-Options: DENY` + on-canvas `DEMO` watermark (folded into #450).
- ✅ **D14-M1 hardware-back closes page instead of dialog** + **D14-C1/C2 PixQrModal in-flight RPC dismissal** — fixed by #447 (canDismiss predicate + Sheet primitive opt-in).
- ✅ **Bogus realtime fan-out from in-component setState** — folded into #446's `hydrateFromServer` / `patchExpenseFromRealtime` consolidation. The `expense.status` / `updatedAt` client-side writes that were polluting realtime broadcasts are gone.
- ✅ Misc cleanup: `charge-explanation.tsx` and 13 unused type guards removed (#448); type rename `ItemSplit`/`BillSplit` → `ExpenseSplit`/`AmountSplit` complete (#449); `simplify.ts` migrated off `Bill*` aliases (#450).

---

## Critical findings still open

### Auth / Identity / Token surface

| | File | Issue |
|---|---|---|
| 🔴 | `src/app/api/dev/login/route.ts:21-34` + `src/app/auth/page.tsx:16` + `.github/workflows/synthetic.yml:8-11,76-78` | `NEXT_PUBLIC_DEV_LOGIN_ENABLED` baked into bundles, defaults to `true` in `dev-setup.sh`, synthetic CI runs prod build with flag on. Session cookies returned in response body. Raw Supabase admin errors interpolated into 5 response paths. |
| 🔴 | `src/app/u/[handle]/page.tsx:19-24` | `createAdminClient()` bypasses RLS for unauthenticated SSR. Returns `id`, `name`, Google `avatar_url`. PR #444 fixed the masking 500 → leak now reachable. No rate limit. |
| 🔴 | `src/app/api/users/lookup/route.ts` + `lookup_user_by_handle` RPC | SECURITY DEFINER, no rate limit, no co-membership check. Returns `id`, `handle`, `name`, `avatar_url` for any handle. Foundation for targeted phishing. |
| 🟠 | `supabase/migrations/20260401200000_create_group_invite_links.sql:76-167` | `join_group_via_link` doesn't check link creator still in group. Test `invite-link-guards.integration.test.ts:138-156` asserts and locks in this behavior — must be removed when the SQL is fixed. |
| 🟠 | `supabase/migrations/20260516120000_*.sql:82-87` | `claim_guest_spot` plain `INSERT INTO group_members` succeeds after the row was deleted by `remove_group_member`. Re-adds a kicked user as `status='accepted'`. |
| 🟠 | `src/components/group/group-detail-content.tsx:351-372` | Any accepted member can re-invite a kicked user via plain `INSERT INTO group_members` through RLS. Kick is reversible by any co-member. |
| 🟠 | `supabase/migrations/20260401500000_leave_group_rpc.sql:40-42` + `remove_group_member` | Creator can never leave the group. No `delete_group` RPC. Only escape: delete auth account, which cascade-nukes the group. |
| 🟠 | `src/app/auth/callback/route.ts:6-35` | OAuth callback open-redirect via Host header — `origin` derived from `request.url`. |
| 🟠 | `supabase/migrations/20260324000000_users_auth_groups.sql:23-72` | `handle_new_user` trigger doesn't strip leading `[._]` from email-local → emails like `.alice@x.com` permanently fail OAuth signup. |
| 🟠 | `src/app/auth/onboard/actions.ts:36-50` | No reserved-handle blocklist. First claimant gets `/u/admin`, `/u/dividimos`, `/u/suporte`. |
| 🟡 | `supabase/migrations/20260418200000_rls_audit_hardening.sql:102-136` | `users_update_own` `WITH CHECK` only checks `auth.uid() = id`. Client can `UPDATE users SET onboarded=true, pix_key_encrypted='garbage'` directly, bypassing `validatePixKey`. |
| 🟡 | `supabase/migrations/20260328003330_*.sql` | `users_read_visible` returns `pix_key_encrypted` to every accepted co-member. Defense-in-depth gap. |

### Pix / Crypto

| | File | Issue |
|---|---|---|
| 🔴 | `src/lib/pix.ts:21-24` | TLV `value.length.toString().padStart(2,"0")` returns `"100"` (3 digits) for value length ≥100 → real banks reject the BR Code. Reachable via long email keys + ID 26 inner wrapper. |
| 🔴 | `src/lib/pix.ts:22,47-60` | `value.length` is UTF-16 code units; EMV requires UTF-8 byte count. Names containing emoji or non-Latin-after-NFD-strip produce parser-mid-character corruption. |
| 🔴 | `src/app/api/pix/generate/route.ts:38-59` | No balance/debt check. Any accepted member can mint R$100k QR for any other member's Pix key. Server-blessed phishing. **#445 infra is ready — wire this route in PR 2/3.** |
| 🟠 | `src/app/api/push/subscribe/route.ts` + `src/lib/push/notify-user.ts` | Single `PIX_ENCRYPTION_KEY` also encrypts FCM tokens and web push subscriptions. No key versioning. Rotation silently wipes all push subscriptions on next notify pass. |
| 🟠 | `src/lib/push/{web-push,fcm,notify-user}.ts` | Missing `import "server-only"` guard. One accidental client import inlines VAPID + FCM private keys. |
| 🟠 | `src/lib/crypto.ts:1` | Same — CLAUDE.md says "Never import from client" but that's a convention, not a compile fence. |
| 🟠 | `src/lib/pix.ts:84-86` | CPF mask `***.***.*89*-01` reveals positions 7-9 plus both check digits. The only entropy hidden is digits 0-7 (~26 bits). |
| 🟡 | `supabase/migrations/20260331000000_remove_phone_and_2fa.sql:2-6` | Unconditional `UPDATE ... SET pix_key_encrypted=''` for phone-type users. If any production user had a phone key, data is unrecoverable. |

### RLS, RPCs, ledger atomicity

| | File | Issue |
|---|---|---|
| 🔴 | `src/lib/supabase/expense-actions.ts:138-251` + `expense_shares/payers` RLS | `saveExpenseDraft` is not transactional. `activate_expense` only locks `expenses`, not child tables. Concurrent Tab A activate + Tab B delete-shares → permanently-active expense with zero balance writes. |
| 🔴 | `supabase/migrations/20260328170000_create_expense_tables.sql:102-107` | `expense_payers` PK + plain INSERT (no `ON CONFLICT`). Duplicate-payer entry → PostgREST 23505, user must rebuild bill. |
| 🔴 | `supabase/migrations/20260412010000_rls_hardening.sql:107-112` | `chat_messages_insert` policy lacks `message_type` guard. Any accepted member can directly INSERT `system_settlement` rows. April audit migration only patched UPDATE. |
| 🔴 | `supabase/migrations/20260418200000_rls_audit_hardening.sql:166-173` | `settlements_insert` RLS still allows direct pending-status insert. Combined with `confirm_settlement` having no "debt still exists" check → debtor can drive their balance negative via pending+record_and_settle+confirm. |
| 🔴 | `supabase/migrations/20260516120000_rpc_hardening_*.sql:165-175` | `confirm_settlement` checks creditor membership but not debtor. Debtor leaves group with pending settlement → creditor confirms later → balance row written for ex-member. |
| 🔴 | `supabase/migrations/20260413000000_security_audit_fixes.sql:91-94` | `record_and_settle` has no idempotency key. Client retry on flaky network → two settlement rows + 2× balance debit. |
| 🟠 | `supabase/migrations/20260328175000_expense_rls_accepted_only.sql:62-140` | `expense_items/shares/payers/guests/guest_shares` INSERT/UPDATE/DELETE policies lack `expenses.status='draft'` guard. Creator can mutate shares of an active expense, desynchronizing display from ledger. |
| 🟠 | `supabase/migrations/20260418200000_rls_audit_hardening.sql:155-158` | `chat_messages_update/delete` gate only on `sender_id = auth.uid()` — sender can rewrite/erase history after being removed from the group. |
| 🟠 | `supabase/migrations/20260328170000_create_expense_tables.sql:130` | `balances.amount_cents` is INT4. ~214 calls at R$100k cap → INT_MAX overflow → silent activation/settlement failure. |
| 🟠 | `leave_group` + `record_and_settle` | Leaver's last `record_and_settle` lands after `leave_group`'s 0-balance cleanup → phantom balance against ex-member. Same shape for `remove_group_member`. |
| 🟠 | `useRealtimeBalances` + `loadData` | Snapshot inversion — if `loadData` snapshotted before a balance update commits and realtime event already fired, UI shows stale numbers until next manual refresh. |
| 🟠 | `src/app/app/bill/[id]/page.tsx:247-260` | #437 dropped reload but `claim_guest_spot` also fires `expenses` UPDATE → stale shares/guests/payers on non-DM groups. |
| 🟡 | `supabase/migrations/20260516120000_*.sql:84-89` | `claim_guest_spot` promotes any token holder to **full accepted** group member, not just expense participant. |
| 🟡 | `supabase/migrations/20260401200000_create_group_invite_links.sql:52-56` | `group_invite_links_update` `WITH CHECK` falls back to `USING`, which only checks `created_by = auth.uid()`. Creator can rewrite `group_id` to a group they don't belong to. |

### Notifications & push

| | File | Issue |
|---|---|---|
| 🔴 | `src/app/api/push/send/route.ts:29-87` | Notification injection endpoint. Caller-supplied title/body/url, no preference check, no rate limit, no length cap. **#445 infra is ready — wire this in PR 2/3, plus add a `notify-pair` canonical-UUID bucket.** |
| 🔴 | `src/lib/push/push-notify.ts:368-400` | `notifyPaymentNudge` has no membership/owed-balance check on debtor/groupId/amount. |
| 🔴 | `public/sw.js:113-128` | `notificationclick` navigates clients to `event.notification.data?.url` without re-validation. |
| 🟠 | `src/lib/push/notify-user.ts:40-66` | `Promise.all` over subscriptions with no per-promise catch. One `web-push.sendNotification` throw aborts cleanup of every other recipient + 500s the entire route. |
| 🟠 | `src/lib/push/notify-user.ts:53-58` | When VAPID is unconfigured but FCM is, every `channel='web'` row throws on every send. Combined with cascade, all notifications 500. |
| 🟠 | `src/app/api/push/subscribe/route.ts:43-71` | FCM-token TOCTOU plus no `UNIQUE(channel, endpoint_hash)`. A user can claim another user's FCM token by re-subscribing. DM previews + settlement amounts delivered to wrong device. |
| 🟠 | `src/lib/push/fcm.ts:135-145` | `sendFcmNotification` treats `INVALID_ARGUMENT` as stale token. Transient FCM payload validation error permanently deletes the subscription. |
| 🟠 | `public/manifest.webmanifest` | Static file shadows the dynamic Next.js manifest. References `../icons/icon-*.webp` (directory doesn't exist) with `"type": "image/png"`. Install prompt fails. |

### Receipt OCR, NFC-e, voice, AI

| | File | Issue |
|---|---|---|
| 🔴 | `src/app/api/receipt/sefaz/route.ts:29` vs `src/lib/nfce-qr.ts:33-41` | SEFAZ allowlist regex `\.(fazenda|sefaz|sef)\.[a-z]{2}\.gov\.br$` doesn't match `nfe.svrs.rs.gov.br` (used by ~10 BR states). QR scans fail end-to-end. |
| 🔴 | `src/lib/nfce.ts:566` + `src/app/api/receipt/sefaz/route.ts:29-43` | Allowlist applied only to initial URL; `redirect: "follow"` + any SEFAZ open-redirect → SSRF to `169.254.169.254` / RFC1918. |
| 🔴 | OCR + voice/parse + chat/parse routes | Zero rate limits on three paid Gemini endpoints. **#445 infra is ready — wire in PR 2/3.** |
| 🟠 | `src/lib/chat-expense-parser.ts:222-225` + `src/lib/voice-expense-parser.ts:188` | Prompt injection: `text` interpolated unescaped; member `handle`/`name` rendered with `\n` permitted. |
| 🟠 | `src/components/bill/scanned-items-review.tsx:110-119` | User-edited items skip `sanitizeReceiptResult` → RTL override, control chars, unsanitized merchant/item descriptions persist to DB. |
| 🟠 | `src/lib/nfce-qr.ts:117-122` | `parseNfceQrCode` accepts any URL containing `?chNFe=` regardless of host. `validateChaveAcesso` is dead code (never called). |
| 🟠 | `src/components/bill/qr-scanner-view.tsx:93-102` | `scanner.start()` race — pause-effect fires before init-effect's awaited start resolves. |
| 🟠 | `src/app/api/receipt/ocr/route.ts:61-67` | `Buffer.from(garbage, "base64")` silently decodes whatever bytes it can. Gemini parses corruption, user charged. |

### Capacitor / Android

| | File | Issue |
|---|---|---|
| 🔴 | `src/lib/capacitor/deep-link.ts:13-15` + `AndroidManifest.xml:23-28` | `dividimos://` scheme has no `android:host`. Any installed app can launch any in-app route via `Intent.ACTION_VIEW`. |
| 🔴 | `src/lib/safe-redirect.ts:5` | `next.includes("://")` is the only scheme check. `dividimos://app/javascript:alert(1)` passes through (no `://` after the colon). |
| 🔴 | `android/app/src/main/res/xml/file_paths.xml` | `<external-path path="."/>` + `<cache-path path="."/>` + `grantUriPermissions=true` → entire external + cache root exfiltrable. |
| 🔴 | `android/app/src/main/res/xml/data_extraction_rules.xml` | Wrong root element for Android <12 `fullBackupContent`. Rules silently ignored. |
| 🔴 | `android/app/build.gradle:21` + line 10 | `minifyEnabled false` ships unobfuscated AABs + `versionCode 1` hardcoded. CI `sed` matches literal `versionCode 1` — any local bump breaks the build silently. |
| 🟠 | `src/app/.well-known/assetlinks.json/route.ts:9` | Single SHA-256 fingerprint won't cover both upload key and Play-managed app-signing key → autoVerify fails for Play-signed builds. |
| 🟠 | `src/lib/capacitor/auth.ts:46-71` + `MainActivity.java:8-29` | Supabase session lives in WebView `localStorage`. No SecureStorage. Combined with broken backup rules, device-transfer can exfiltrate sessions. |

### Bill store / client math

| | File | Issue |
|---|---|---|
| 🔴 | `src/stores/bill-store.ts:471-483` | `splitBillByPercentage` rounds each row independently. `[33.34, 33.34, 33.33]` × 10000 = 10001 → server rejects with `shares_mismatch`. |
| 🔴 | `src/lib/simplify.ts:81-146` vs `activate_expense` | Client uses largest-remainder; server uses per-pair ROUND. Preview disagrees with ledger by 1+ cent per consumer. (Independent from #442 — #442 fixed the global invariant, this is the client/server algorithm mismatch.) |
| 🔴 | `src/stores/bill-store.ts:292-313` | `removeParticipant`/`removeGuest` doesn't cascade to `payers`. Orphan payment silently dropped from preview + FK violation on save. |
| 🔴 | `src/components/ui/currency-input.tsx:24-29` | Paste of "R$ 1.234,56" becomes R$ 1.23 (comma→dot then `parseFloat` eats the first dot). |
| 🟠 | `src/app/app/bill/new/page.tsx:466-484` | Editing an itemized draft loses per-item split assignments (no `expense_item_splits` table; page sets `splits: []` unconditionally on restore). |
| 🟠 | `single-amount-step.tsx:288` vs `bill-store.ts:474` | UI tolerance 0.1% vs store rejection 0.01% → 0.09 pp dead zone. |
| 🟠 | `src/stores/bill-store.ts:268-284` | `setExpenseType` doesn't clear `payers` → stale payer entries cross expense types. (#446 added a new test for items/splits clearing but doesn't cover payers — finding ships with explicit test coverage gap.) |

### Realtime, React hooks, UI state

| | File | Issue |
|---|---|---|
| 🟠 | `src/contexts/user-context.tsx:62-67` | `USER_UPDATED` branch is dead code (same-id guard) → profile changes never propagate without hard reload. (#443 memo'd the value but explicitly deferred this fix.) |
| 🟠 | `src/hooks/use-realtime-expense.ts:16-50` | Missing callback-ref pattern — inline callbacks re-subscribe every render. |
| 🟠 | `src/hooks/use-unread-conversations.ts:39-62` | Subscribes to all `chat_messages` INSERTs (no `group_id` filter). Static channel name `"unread-badge"` collides on HMR/multi-mount. Double-counts on the active conversation. |
| 🟠 | `src/components/chat/conversation-pay-button.tsx:178-188` | Parallel `Promise.all(recordSettlement[])` (#436) leaves partial-success window — one rejection → user retries → double-settle. |

### Lists, search, dashboard, activity

| | File | Issue |
|---|---|---|
| 🔴 | `src/app/app/bills/page.tsx:13-16` + `bills-list-content.tsx:38-50` | Bills list leaks other users' DRAFT expenses to all accepted group members. No status filter; diverges from `listGroupExpenses` pattern. |
| 🔴 | `src/components/search/search-content.tsx:92-97` | Search leaks drafts. Groups query has no `is_dm` filter → clicking DM result opens `/app/groups/<id>` instead of the chat. |
| 🔴 | `src/components/search/search-content.tsx:82,95,101` | PostgREST `.or()` with unescaped user input. Comma in input ("Joaquim, Maria") breaks filter parsing; `%`/`_` broaden silently. |
| 🟠 | `src/lib/supabase/activity-actions.ts:149-168,265-305` | Pagination emits duplicate `settlement-conf-<id>` items because cursor uses `created_at` only while mapper emits both `rec` and `conf` items. |
| 🟠 | `dashboard-content.tsx:120-133, 414, 423-424` | `recordSettlement` throw leaves `acting` stuck → DebtCard disabled. Worse: `acting` key uses `+` concat but DebtCard compares against `-`-joined key → `isActing` is always false (double-submit possible). |
| 🟠 | `src/components/dashboard/quick-charge-modal.tsx:69-127` | Rapid regenerate leaks orphan `vendor_charges` pending rows — `insertPromiseRef` overwritten without cancelling prior insert. |

### Timezones & dates

| | File | Issue |
|---|---|---|
| 🟠 | `src/lib/supabase/settlement-actions.ts:139-148` | `recordSettlement` synthesizes `createdAt`/`confirmedAt` from `new Date()`. Diverges from DB row → sort-order anomalies, chat-date-separator boundary bugs. |
| 🟠 | `src/lib/supabase/activity-actions.ts:142,163,186` + `chat-actions.ts:63,239` | Pagination cursor `.lt(created_at, before)` is strict — drops ties. `record_and_settle` and `confirm_settlement` insert multiple chat rows at the same `now()` within a single transaction → reachable. |
| 🟠 | `src/components/dashboard/dashboard-content.tsx:49-54, 212` | `getGreeting()` uses `new Date().getHours()` in a client component with server-rendered initial markup → hydration mismatch on BR/UTC boundary. |
| 🟠 | `src/components/dashboard/charge-history-list.tsx:32-42` | "Recebido hoje" computed from device-local midnight. Travelling user / manually-set device time → wrong daily total. |
| 🟠 | `src/app/app/bills/page.tsx:47-51` | Server component formats `toLocaleDateString("pt-BR")` using Node process TZ. Fly defaults to UTC → bill list shows wrong calendar day for evening BR bills. |
| 🟡 | `src/lib/activity-badge.ts:6-7,20` | Lexicographic ISO comparison — Postgres `+00:00` (0x2B) sorts below `Z` (0x5A) from JS. Activity badge boundary bugs. |

### Error handling

| | File | Issue |
|---|---|---|
| 🔴 | `src/app/api/dev/login/route.ts:70/87/135/167/193` | Raw Supabase admin error messages interpolated into 5 response paths. (Same surface as TL;DR #1.) |
| 🟠 | `src/lib/api-response.ts:31` + `errors.ts:285-294` | `apiErrorResponse` forwards `Error.message` verbatim. 40+ `throw new Error(\`Failed to query X: ${error.message}\`)` sites in actions/routes leak SQL column names, RLS detail. |
| 🟠 | `dashboard-content.tsx:120-133`, `group-settlement-view.tsx:221`, `bill/[id]/page.tsx:1079` | `await recordSettlement` outside try/catch → `acting` state stuck on RLS failure. |
| 🟠 | `src/hooks/use-realtime-*.ts` | All four realtime hooks cast `payload.new as RowType` with no runtime validation. Partial UPDATE crashes the mapper; no error boundary. |

### CI / build / tests

| | File | Issue |
|---|---|---|
| 🔴 | `.github/workflows/migrations.yml:42-56` | `replay` job runs PR migrations against an ephemeral DB but the job has no `permissions: contents: read`, no `persist-credentials: false`. Fork PR can exfil `GITHUB_TOKEN`. |
| 🔴 | `.github/workflows/synthetic.yml:1-122` | Builds and runs PR code with secrets in env; no `permissions` block; `npm ci` without `--ignore-scripts` → `postinstall` hijack. |
| 🟠 | `.github/workflows/android.yml:58` | `versionCode` sed matches literal `versionCode 1`. Local bump silently breaks the build forever. |
| 🟠 | all workflows | Floating `@v4` action tags. Supply-chain risk on any maintainer-account compromise. |
| 🟠 | `src/lib/supabase/expense-rpc-math.test.ts` | 836-line JS reimplementation of PL/pgSQL math, tested against itself. Never calls the real `activate_expense` RPC. |
| 🟠 | `src/lib/supabase/chat-messages.integration.test.ts:83-98` | Test explicitly asserts that a regular user can INSERT `message_type='system_expense'`. Locks in the system-message-forgery hole as expected behavior. Must be removed when the policy is fixed. |
| 🟠 | `src/lib/push/notify-user.test.ts` | Zero `mockRejectedValue` case despite the cleanup-on-throw cascade. |
| 🟠 | `src/lib/supabase/group-membership.integration.test.ts:817-823` | Both-branches-pass `if (error) ... else ...` — test passes whether the production code rejects or accepts invited members. |
| 🟠 | `src/lib/currency.test.ts:74-76, 112-114` | Tests **pin money correctness bugs as expected behavior**: `decimalToCents(1.005)` returns 100 (loses a cent); `test.fails` for `parseBRLInput("1.234,56")` returning 123 cents instead of 123456. Fixing them now breaks tests. |
| 🟠 | (multiple integration tests) | Zero coverage for: `vendor_charges` RLS, prompt-injection in chat/voice parsers, `record_and_settle` idempotency on retry, `confirm_settlement` debtor-membership check. |
| 🟠 | `e2e/auth.setup.ts:66,106,141` | Cookie `domain: "localhost"` hardcoded. Any `E2E_BASE_URL` override silently produces tests with cookies that don't apply. |
| 🟠 | `e2e/flows/settlement.spec.ts` | Entire spec is conditional (`if (visible) ... else test.skip`). On a clean CI DB every test skips, harness reports green. False-positive coverage. |
| 🟠 | `e2e/synthetic/*settlement*.spec.ts` | Every settlement test calls `record_and_settle` RPC directly, bypassing the two-step `recordSettlement → confirmSettlement` UI flow. |

---

## Acknowledged tradeoffs (not bugs, but worth documenting)

- **Per-user ledger drift in `activate_expense` (post-#442):** the global sum-of-balances invariant is now exact, but a user appearing in K canonical pairs can still be off by up to ±K cents vs. their validated share. Migration doc and integration tests pin this. For pathological inputs (constructed: `total=100, shares=[A:1, B:99], payers=[C:33, D:33, E:34]`), user B is ledger-debited 100¢ while consuming 99¢. The fix (true largest-remainder distribution pinning per-user totals to validated shares) was deferred — product decision needed on whether to ship the residual UX impact or invest in the deeper algorithm change.
- **Settlement of invited (non-accepted) counterparty:** `record_and_settle` allows the counterparty to be `status='invited'`. This is intentional per main's hardening migration to support the ad-hoc bill flow where someone is added by handle but hasn't accepted yet. Worth documenting in CLAUDE.md so future RLS audits don't try to "fix" it.

---

## Exploit chains still reachable

After PRs #442–#450 merge, the following chains from W2-16 remain reachable:

- **Chain A — Account takeover via dev-login leak.** Foundation: TL;DR #1. Single best fix: lock route to `@test.dividimos.local` allowlist + drop `NEXT_PUBLIC_` flag.
- **Chain B — Handle enumeration → targeted phishing.** Foundation: TL;DR #2 + the unrate-limited `/api/users/lookup`. Mitigated when PR 2/3 of the rate-limit series wires those routes.
- **Chain C — Post-activation ledger fraud.** Foundation: `expense_shares` etc. RLS lacks `status='draft'` guard + `chat_messages_insert` lacks `message_type` guard.
- **Chain D — Confused-deputy push + chat forgery.** Foundation: TL;DR #5 + #6. Two RLS tightenings + rate-limit wire-up close this.
- **Chain E — Pre-claim hijack.** Foundation: `expense_guests.claim_token` visible to every accepted member via RLS + `claim_guest_spot` doesn't gate on expense status.
- **Chain F — Persistent backdoor via invite-link survival.** Foundation: TL;DR #7.
- **Chain G — `javascript:` URI via `safeRedirect` + deep link.** Foundation: `dividimos://` scheme no host + `safeRedirect` `://`-substring weakness.
- **Chain H — Pix BR Code malformed.** Foundation: TL;DR #3.
- **Chain I — Push spam DoS.** Foundation: `notifyPaymentNudge` no auth check + `/api/push/send` no rate limit. Closes when #445 PR 2/3 wires the routes.
- **Chain J — Pending-settlement reversal post-leave.** Foundation: TL;DR #10. Single best fix: `confirm_settlement` checks debtor membership, `leave_group` deletes orphan pending settlements.

---

## Outstanding worktree

`.claude/worktrees/fix+rls-audit-hardening` (branch `worktree-fix+rls-audit-hardening`) — recommendation unchanged from earlier audit: **close this PR**. Main is strictly more hardened (the worktree's `record_and_settle` change would break ad-hoc bills, its `activate_expense` lacks share/payer membership validation that main has, and its migration filename collides with `20260411000000_create_chat_messages.sql` on main). If individual items from it are still wanted (e.g., `admin.ts` `server-only` guard), cherry-pick onto a new branch off main.

---

## Recommended next fix order

Given the post-#442–#450 state:

1. **`/api/dev/login` hard-kill in non-dev.** Drop `NEXT_PUBLIC_DEV_LOGIN_ENABLED`, gate route+UI on `NODE_ENV === "development"` only, allowlist `@test.dividimos.local`, stop returning cookies in body, sanitize error messages. Same-day fix.
2. **Single RLS migration closing Chains C + D + J.** Pin `chat_messages_insert` to `message_type='text'`; add `expenses.status='draft'` to all child expense table policies; add counterparty-membership check to `confirm_settlement`; have `leave_group` delete or invalidate pending settlements. Remove the lock-in tests at `chat-messages.integration.test.ts:83-98` and `group-membership.integration.test.ts:817-823`.
3. **Pix TLV correctness.** Switch `tlv()` to UTF-8 byte length with overflow guard, CRC16 to operate on UTF-8 bytes, add `key.length` cap in `validatePixKey`.
4. **`/api/pix/generate` debt-link** + wire `enforceRateLimit` from #445 to it.
5. **Rate-limit wire-up (PR 2/3 of #445)** for `/api/users/lookup`, `/api/push/send`, `/api/chat/parse`, `/api/voice/parse`, `/api/receipt/ocr`, `/api/receipt/sefaz`.
6. **`server-only` guards** on `src/lib/crypto.ts`, `src/lib/push/{web-push,fcm,notify-user,push-notify}.ts`.
7. **`/u/[handle]` admin-bypass.** Replace `createAdminClient()` with a SECURITY DEFINER RPC `get_public_profile(handle)` returning only the fields the page renders.
8. **Kick authoritativeness.** Add `group_bans` table populated by `remove_group_member`/`leave_group`; `join_group_via_link`, `claim_guest_spot`, `group_members_insert` all consult it; deactivate creator's invite links on leave. Remove `invite-link-guards.integration.test.ts:138-156`.
9. **`saveExpenseDraft` transactional.** Wrap the delete+insert sequence in a SECURITY DEFINER RPC; add `FOR UPDATE` on child tables in `activate_expense`.
10. **Test pollution.** Remove `currency.test.ts:74-76` and `:112-114`, then fix the underlying functions. Audit the rest of the test files in the "Tests that lie" group.
11. **Client/server rounding alignment.** Either replace per-pair `ROUND` in `activate_expense` with largest-remainder distribution (closing the per-user-drift tradeoff), or replace client's largest-remainder with per-pair ROUND (accepting the drift but matching display to ledger).
12. **Demo + manifest + sw.js cleanup.** Static `public/manifest.webmanifest` should be deleted (lets the dynamic `src/app/manifest.ts` serve); `sw.js notificationclick` should re-validate `data.url` before navigation.

After this, the long tail (CI hardening, error-message sanitization at the API-response layer, realtime payload validation, timezone normalization on the server, kick lifecycle) can be batched into a single hardening sprint.
