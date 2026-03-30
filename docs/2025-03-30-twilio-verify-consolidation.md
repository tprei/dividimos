# Consolidate phone auth onto Twilio Verify

**Date:** 2026-03-30
**Status:** Draft
**Scope:** Replace Supabase `signInWithOtp` production path with Twilio Verify + admin magic-link

## Problem

Phone login uses two independent SMS paths:

1. **Primary login** (`phone-actions.ts`, production path) calls `supabase.auth.signInWithOtp({ phone })`, which relies on an SMS provider configured in the Supabase Dashboard (Twilio, via Supabase's built-in integration).
2. **2FA** (`/api/auth/2fa/*`) calls `sendVerificationCode`/`checkVerificationCode` from `src/lib/twilio.ts`, hitting the Twilio Verify API directly.

Both paths ultimately use Twilio, but through different integration points. The Supabase-managed SMS path adds configuration surface area, a separate billing dimension, and rate limits that Pagajaja doesn't control.

## Current vs target architecture

```
CURRENT
=======
                     +-------------------+
  Login (prod)  ---> | Supabase Auth OTP | ---> Supabase SMS Provider (Twilio)
                     +-------------------+
                             |
                     creates session via
                     verifyOtp(phone, token, "sms")

                     +-------------------+
  Login (test)  ---> | Admin magic-link  | ---> no SMS (any 6-digit code)
                     +-------------------+
                             |
                     creates session via
                     generateLink + verifyOtp(token_hash, "magiclink")

                     +-------------------+
  2FA           ---> | Twilio Verify     | ---> Twilio Verify API (direct)
                     +-------------------+

TARGET
======
                     +-------------------+     +-------------------+
  Login (prod)  ---> | Twilio Verify     | --> | Admin magic-link  |
                     +-------------------+     +-------------------+
                       send/check SMS            create session same
                       via src/lib/twilio.ts     as current test path

                     +-------------------+
  Login (test)  ---> | Admin magic-link  | ---> no SMS (unchanged)
                     +-------------------+

                     +-------------------+
  2FA           ---> | Twilio Verify     | ---> unchanged
                     +-------------------+
```

After the change, all SMS goes through the three `TWILIO_*` env vars. The Supabase Dashboard SMS provider config can be removed.

## Files to modify

### 1. `src/app/auth/phone-actions.ts` (primary change)

**`sendTestOtp` -- production branch (lines 29-34):**
Replace `supabase.auth.signInWithOtp({ phone })` with a call to `sendVerificationCode(normalized)` from `src/lib/twilio.ts`.

```
Before:
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: normalized });

After:
  const { sendVerificationCode } = await import("@/lib/twilio");
  const result = await sendVerificationCode(normalized);
  if (!result.success) {
    return { error: "Erro ao enviar codigo de verificacao" };
  }
```

**`verifyPhoneOtp` -- production branch (lines 125-157):**
Replace `supabase.auth.verifyOtp({ phone, token, type: "sms" })` with:
1. `checkVerificationCode(normalized, code)` from `src/lib/twilio.ts`
2. On success, the admin magic-link session creation pattern (already proven in the test-mode branch above it, lines 47-103)

The session creation logic (find-or-create user by phone, generate magic link, verify token hash, check onboarded/2FA) is identical to the test-mode path. Extract a shared helper to avoid duplication:

```typescript
async function createSessionForPhone(
  normalized: string,
  safePath: string,
): Promise<{ success?: boolean; redirect?: string; error?: string }> {
  const admin = createAdminClient();
  const supabase = await createClient();
  const testEmail = phoneToTestEmail(normalized);

  // Find or create user (existing logic from test-mode branch)
  // Generate magic link + verify token hash (existing logic)
  // Check onboarded + 2FA status (existing logic)
}
```

Then both branches call `createSessionForPhone`, with the only difference being:
- **Test mode:** Skips SMS, accepts any 6-digit code
- **Production:** Calls `sendVerificationCode` / `checkVerificationCode` first

**`listUsers` scalability fix:** The current test-mode path calls `admin.auth.admin.listUsers()` without filters, scanning all users. For production use, replace with `admin.auth.admin.listUsers({ filter: ... })` or query by email directly. Supabase admin API does not support phone-based lookup, but the `phoneToTestEmail` mapping makes the email-based lookup deterministic. Use `admin.auth.admin.listUsers()` with pagination set to 1 + a filter, or query the `auth.users` table via the service role client's `.from("auth.users")` -- but the simplest approach is `admin.auth.admin.getUserById` after looking up by email. Actually, the admin API does not support email lookup natively either. The pragmatic fix: use the existing `phoneToTestEmail` mapping and call `admin.auth.admin.listUsers({ page: 1, perPage: 1 })` as a bounded query, then filter. This is a pre-existing issue in the test-mode path and not a blocker for this change. File a follow-up to replace with a direct `auth.users` table query.

### 2. `.env.local.example` (documentation update)

Update the Twilio env var comment from "used for phone-based 2FA" to "used for all phone-based authentication (login + 2FA)".

### 3. No changes required

- `src/lib/twilio.ts` -- already has `sendVerificationCode` and `checkVerificationCode` with test-mode bypass
- `src/lib/twilio.test.ts` -- existing tests cover both modes
- `src/app/api/auth/2fa/*` -- untouched
- `src/app/auth/page.tsx` -- UI is unchanged; it already calls `sendTestOtp`/`verifyPhoneOtp` as server actions
- `src/app/api/dev/login/route.ts` -- dev-only, test-mode gated, unaffected

## Edge cases and risks

| Risk | Mitigation |
|------|------------|
| **Twilio Verify rate limits** differ from Supabase's SMS rate limits | Twilio Verify enforces max 5 send attempts per phone per 10 minutes. The existing 2FA flow already operates within these limits. Login should be the same. Monitor after deploy. |
| **Magic-link token expiry** | Supabase magic-link tokens expire after 1 hour by default. The gap between `generateLink` and `verifyOtp` is milliseconds (same server action), so this is not a practical concern. |
| **User creation race condition** | Two concurrent signups for the same phone could create duplicate users. The test-mode path has this same window today. The `phoneToTestEmail` mapping ensures email uniqueness in Supabase Auth, which rejects duplicates. The second `createUser` call would fail, and the next retry would find the existing user. |
| **No fallback if Twilio is down** | Same risk as the existing 2FA flow. Twilio Verify has 99.95% SLA. If it's down, phone login is unavailable. Google OAuth remains as an alternative login method. |
| **`listUsers` at scale** | Pre-existing concern in the test-mode path. For production, this scans all auth users. See the note above -- file a follow-up to replace with a bounded query. Not a launch blocker since Pagajaja is pre-launch with a small user base. |
| **Removing Supabase SMS config prematurely** | Remove the Supabase Dashboard SMS provider config only after confirming the new path works in production. The old `signInWithOtp` code will be deleted, so no code path would use it, but leaving the config is harmless. |

## Verification steps

### Automated

1. Add a unit test for `phone-actions.ts` covering the production path:
   - Mock `sendVerificationCode` and `checkVerificationCode` from `src/lib/twilio.ts`
   - Mock `createAdminClient` for user lookup and magic-link generation
   - Verify `signInWithOtp` is never called
   - Verify the correct redirect for onboarded vs non-onboarded users

2. Existing `src/lib/twilio.test.ts` tests continue to pass (no changes to that module).

3. `npm run build` passes (type-checks the server actions).

### Manual

1. **Test mode** (regression): Navigate to `/auth` -> phone login -> enter any 6 digits -> confirm session is created and redirect works. This path should be completely unchanged.

2. **Production mode** (new behavior): With `NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=false` and valid `TWILIO_*` env vars:
   - Enter a real phone number -> receive SMS via Twilio Verify
   - Enter the code -> session is created via admin magic-link
   - First-time user is redirected to onboarding
   - Returning user with 2FA enabled is redirected to `/auth/verify-2fa`
   - Returning user without 2FA goes to `/app`

3. **Supabase Dashboard**: After confirming production works, remove the SMS provider (Twilio) configuration from the Supabase project settings. Verify phone login still works (confirming it no longer depends on the Dashboard config).

## Implementation estimate

This is a single-file change with a small refactor (extract `createSessionForPhone` helper). The production branch of `sendTestOtp` drops from 5 lines to 5 lines (different ones). The production branch of `verifyPhoneOtp` drops from 30 lines to ~5 lines (delegating to the shared helper). Net code delta is roughly zero.

One file to modify (`phone-actions.ts`), one file to update comments (`.env.local.example`), one test file to create (`phone-actions.test.ts`).
