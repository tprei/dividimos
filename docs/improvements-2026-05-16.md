# Improvement Plan — 2026-05-16

Synthesized from 10 parallel audit reports (security, performance, type safety, frontend UX, database, state, testing, API, Capacitor, tech debt).

## P0 — security & correctness (this week)

Each P0 item lands as its own PR with CI green and tests at the right layer.

| ID | Title | Files | Test layer |
|----|-------|-------|------------|
| S1 | `/api/pix/generate` amount validation (integer, max cap) | `src/app/api/pix/generate/route.ts` | unit |
| S2 | `/api/pix/generate` accepted-member check tightening + dead `billId` branch | same file | unit |
| S3 | `claim_guest_spot` `FOR UPDATE` lock on expense row | new migration | integration |
| S4 | `confirm_settlement` accepted-group-membership check | new migration | integration |
| S5 | Regenerate `src/types/database.ts` from live schema | `src/types/database.ts` | typecheck |
| S6 | Type Supabase client against `Database` | `src/lib/supabase/{client,server,admin}.ts` + downstream | typecheck + unit |
| S7 | Android manifest: `allowBackup=false`, remove cleartext from release, restrict FileProvider | `android/app/src/main/AndroidManifest.xml`, `file_paths.xml` | manual native verify |
| S8 | Deep-link `safeRedirect` validation | `src/lib/capacitor/index.ts` | unit |
| S9 | Viewport zoom restoration | `src/app/layout.tsx` | manual (visual) |
| S10 | PixQrModal dialog semantics (a11y) | `src/components/settlement/pix-qr-modal.tsx` | unit + synthetic E2E |

## Execution rules

- One worktree + branch per item (or per closely-coupled pair).
- Branch naming: `fix/<short-slug>` (e.g. `fix/pix-generate-validation`).
- Each PR: title concise, summary `why` not `what`, test plan checklist.
- CI must pass: unit (`npm test`), typecheck (`tsc --noEmit`), lint (`npm run lint`), integration (Supabase) where applicable.
- No giant agent prompts — small focused edits, planner/implementer/reviewer agents per item.
- Land in order. Each PR independent so they can ship serially without merge churn.

## P1 / P2

See the conversation synthesis. P1 items will be planned after P0 lands.
