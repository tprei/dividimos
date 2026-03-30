# Pagajaja Production Readiness Research

> Research compiled March 2026. Prices and feature availability may change.

## Table of Contents

1. [Hosting Options Comparison](#1-hosting-options-comparison)
2. [Cloudflare + OpenNext Deep Dive](#2-cloudflare--opennext-deep-dive)
3. [Error Monitoring & Observability](#3-error-monitoring--observability)
4. [Security Hardening](#4-security-hardening)
5. [Database & Supabase Production Checklist](#5-database--supabase-production-checklist)
6. [CI/CD Improvements](#6-cicd-improvements)
7. [Performance Optimizations](#7-performance-optimizations)
8. [PWA & Mobile Experience](#8-pwa--mobile-experience)
9. [LGPD Compliance](#9-lgpd-compliance)
10. [Free Tier Summary](#10-free-tier-summary)
11. [Priority Roadmap](#11-priority-roadmap)

---

## 1. Hosting Options Comparison

### Vercel (Recommended for Launch)

| Aspect | Details |
|--------|--------|
| **Free tier** | 100 GB bandwidth, 100 hrs serverless, 6000 mins build/mo |
| **Pro** | $20/user/mo — 1 TB bandwidth, 1000 hrs serverless |
| **Strengths** | Zero-config Next.js, preview deploys, Speed Insights, Skew Protection |
| **Weaknesses** | Bandwidth overages expensive ($40/100GB), US-East default (latency for Brazil) |
| **Brazil latency** | ~150-200ms from São Paulo (nearest edge: GRU via CDN, but serverless runs US-East) |

**Why it's best for launch:** Pagajaja uses `proxy.ts` (Next.js 16 convention), which only Vercel supports natively. Zero config means shipping faster.

### Cloudflare Workers + OpenNext

| Aspect | Details |
|--------|--------|
| **Free tier** | 100K requests/day, 10ms CPU/request, 3 MiB bundle limit |
| **Paid** | $5/mo — 10M requests, 30s CPU, 10 MiB bundle limit |
| **Strengths** | No cold starts (V8 isolates), São Paulo PoP, industry-best DDoS/WAF, zero egress |
| **Weaknesses** | `proxy.ts` unsupported, manual setup, bundle size limits, `'use cache'` not yet supported |

See [Section 2](#2-cloudflare--opennext-deep-dive) for detailed analysis.

### Fly.io

| Aspect | Details |
|--------|--------|
| **Free tier** | 3 shared VMs, 160 GB outbound, 3 GB persistent storage |
| **Paid** | ~$5-15/mo for a small app |
| **Strengths** | São Paulo region (GRU), Docker-based (full Node.js), good for long-running processes |
| **Weaknesses** | Container cold starts, manual scaling config, no built-in preview deploys |

### Coolify (Self-Hosted on Hetzner)

| Aspect | Details |
|--------|--------|
| **Cost** | ~€3.49/mo (Hetzner CX22) + free Coolify (self-hosted) |
| **Strengths** | Full control, Docker/Node.js native, one-click deploys, no vendor lock-in |
| **Weaknesses** | No São Paulo region (nearest: US-East), you manage the server, SSL, updates |

### Netlify

| Aspect | Details |
|--------|--------|
| **Free tier** | 100 GB bandwidth, 300 build mins, 125K serverless invocations |
| **Strengths** | Good DX, similar to Vercel |
| **Weaknesses** | Next.js support lags behind Vercel, no `proxy.ts` support |

### Railway

| Aspect | Details |
|--------|--------|
| **Free tier** | $5 free credit/mo (trial), then $5/mo Hobby plan |
| **Strengths** | Simple Docker deploys, good for backends |
| **Weaknesses** | No São Paulo region, less Next.js-specific optimization |

### Render

| Aspect | Details |
|--------|--------|
| **Free tier** | Static sites free, web services spin down after inactivity |
| **Strengths** | Simple pricing, good for static + API |
| **Weaknesses** | Cold starts on free tier (30+ seconds), limited serverless |

---

## 2. Cloudflare + OpenNext Deep Dive

### What OpenNext Supports

✅ App Router 
✅ Route Handlers 
✅ Dynamic routes 
✅ Static Site Generation (SSG) 
✅ Server-Side Rendering (SSR) 
✅ Edge Middleware (standard `middleware.ts`) 
✅ Image optimization (with manual setup) 
✅ Partial Prerendering (PPR) 
✅ Pages Router 
✅ Incremental Static Regeneration (ISR) 
✅ `after()` function 
✅ Turbopack 
✅ `node:crypto` with `nodejs_compat` flag 

### What OpenNext Does NOT Support

❌ **Node Middleware / `proxy.ts`** — Pagajaja uses `proxy.ts` for Supabase auth session management. Must be renamed to `middleware.ts` and rewritten as Edge middleware until OpenNext adds support. 
❌ **`'use cache'` (Composable Caching)** — Planned but not yet implemented. 

### Hard Constraints

#### Bundle Size Limits

| Plan | Compressed Limit |
|------|------------------|
| Free | 3 MiB |
| Paid ($5/mo) | 10 MiB |

Pagajaja dependencies (`framer-motion`, `qrcode`, `@supabase/supabase-js`, `shadcn`, `zustand`, `lucide-react`) plus Next.js itself will likely exceed 3 MiB. A real-world Next.js 16 migration found their initial bundle was **49.6 MB uncompressed**. Aggressive optimization (tree-shaking, Webpack forced over Turbopack, `optimizePackageImports`) is required.

#### I/O Isolation

Cloudflare Workers cannot share I/O objects (streams, DB connections) across requests. Pagajaja creates Supabase clients per-request in middleware — this is fine. But a global Supabase client would fail with "Cannot perform I/O on behalf of a different request."

### Image Optimization on Cloudflare

Not zero-config like Vercel. Requires:
1. Cloudflare Images subscription
2. Custom `image-loader.ts` file at project root
3. `IMAGES` binding in `wrangler.jsonc`
4. `loader: "custom"` in `next.config.ts`
5. Manual remote origins config in CF dashboard (Next.js `remotePatterns` is ignored)
6. `minimumCacheTTL` is not supported

### `node:crypto` Compatibility

Pagajaja's `src/lib/crypto.ts` uses `createCipheriv`/`createDecipheriv` with AES-256-GCM. This **works** on Cloudflare Workers since April 2025 with:
- `nodejs_compat` compatibility flag enabled
- `compatibility_date >= 2024-09-23`

### Vercel-Exclusive Features Lost

| Feature | What it does | Cloudflare alternative |
|---------|-------------|------------------------|
| Speed Insights | Real User Monitoring (Core Web Vitals) | Cloudflare Web Analytics (separate) or self-host `web-vitals` |
| Skew Protection | Client/server version sync during rolling deploys | No equivalent |
| Vercel Toolbar | Visual editing, feature flags, draft mode | No equivalent |
| PR Preview Comments | Auto-comments with preview URL | Preview URLs exist, no auto-comments |
| `vercel.json` Cron Jobs | Simple cron for scheduled functions | Cloudflare Cron Triggers (different config) |
| Vercel KV/Postgres/Blob | Managed storage | Cloudflare KV, D1, R2 (different APIs) |
| Vercel Firewall | Bot protection, rate limiting | Cloudflare WAF (**superior**) |
| Conformance | Automated Next.js code quality | No equivalent |
| Zero-config | `git push` → deployed | Wrangler config, adapter, flags, custom loaders |

### What Cloudflare Does Better

| Advantage | Detail |
|-----------|--------|
| No cold starts | V8 isolates boot in <1ms |
| Global edge | 285+ data centers including **São Paulo** |
| DDoS protection | Industry-leading, included free |
| WAF | Enterprise-grade, included in paid plans |
| Pricing | No surprise bandwidth bills. $5/mo flat + usage |
| R2 storage | S3-compatible, **zero egress fees** |
| KV | Global key-value store, replicated to all edges |

### Verdict

Stick with **Vercel for launch**. The `proxy.ts` incompatibility is a hard blocker. Revisit Cloudflare when costs become a concern at scale — OpenNext will likely have caught up by then.

---

## 3. Error Monitoring & Observability

### Sentry (Recommended)

| Plan | Cost | Limits |
|------|------|--------|
| Developer | Free | 1 user, 5K errors/mo, 10K replays, 10K spans |
| Team | $26/mo | Unlimited users, 50K errors, 50K replays, 100K spans |

**Setup for Next.js 16:**

```bash
npx @sentry/wizard@latest -i nextjs
```

This creates:
- `sentry.client.config.ts` — Browser-side error capture
- `sentry.server.config.ts` — Server-side error capture  
- `sentry.edge.config.ts` — Edge/middleware error capture
- `src/app/global-error.tsx` — Root error boundary
- Wraps `next.config.ts` with `withSentryConfig()`

**Key features:**
- Source maps upload (automatic with Vercel integration)
- Session replay (watch exactly what users did before an error)
- Performance tracing (identify slow API routes, DB queries)
- Release tracking (associate errors with deploys)

### OpenTelemetry Alternative

Next.js has built-in OpenTelemetry support via `instrumentation.ts`. Can export to:
- **SigNoz** (open-source, self-hosted) — Free
- **Grafana Cloud** — Free tier: 50 GB traces/mo
- **Honeycomb** — Free tier: 20M events/mo

More setup overhead than Sentry but more flexible for custom metrics.

### Structured Logging

Add `pino` or `winston` for JSON-structured server logs. Critical for debugging production issues that aren't exceptions.

---

## 4. Security Hardening

### Rate Limiting with Upstash Redis

| Plan | Cost | Limits |
|------|------|--------|
| Free | $0 | 10K commands/day, 256 MB |
| Pay-as-you-go | $0.2/100K commands | No daily limit |

**Critical routes to protect:**
- `POST /api/pix/generate` — QR code generation (expensive, server decrypts Pix key)
- `GET /api/users/lookup` — Handle lookup (prevent enumeration)
- `POST /api/dev/login` — Dev login (even in dev, rate limit)
- All auth endpoints (via Supabase, but add app-level limits too)

**Implementation pattern:**

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"), // 10 requests per 60s
  analytics: true,
});

// In your route handler:
const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
const { success } = await ratelimit.limit(ip);
if (!success) {
  return NextResponse.json({ error: "Too many requests" }, { status: 429 });
}
```

### Content Security Policy (CSP)

Add to `proxy.ts` (or a custom `next.config.ts` headers config):

```typescript
const cspHeader = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: *.supabase.co *.googleusercontent.com;
  connect-src 'self' *.supabase.co;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;
```

### Dev Login Route Hardening

Current guard uses `NEXT_PUBLIC_AUTH_PHONE_TEST_MODE` which is baked into client bundles. Double-gate:

```typescript
if (
  process.env.NODE_ENV === "production" ||
  process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE !== "true"
) {
  return NextResponse.json({ error: "Not available" }, { status: 403 });
}
```

Also: the `listUsers()` call in the dev login route downloads ALL users with no pagination — dangerous even in dev.

### Additional Security Headers

```typescript
const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
```

---

## 5. Database & Supabase Production Checklist

### Plan Selection

| Plan | Cost | Key Limits |
|------|------|------------|
| Free | $0 | 500 MB DB, **auto-pauses after 7 days inactivity**, no backups, shared compute |
| Pro | $25/mo | 8 GB DB, daily backups (7-day retention), dedicated compute, no auto-pause |

**Critical:** The free tier auto-pauses your database after 7 days of inactivity. For a production app, this means cold starts of 30+ seconds when someone visits after a quiet period. **Pro is required for production.**

### RLS (Row Level Security) Audit

Ensure every table has RLS enabled with appropriate policies:
- Users can only read/write their own profiles
- Group members can only see groups they belong to
- Bill data is scoped to participants
- `user_profiles` view exposes only safe columns (id, handle, name, avatar_url)

### Database Indexes

Add indexes for common query patterns:
```sql
-- Handle lookups (exact match)
CREATE INDEX idx_users_handle ON users (handle);

-- Group membership queries
CREATE INDEX idx_group_members_user ON group_members (user_id, status);
CREATE INDEX idx_group_members_group ON group_members (group_id, status);

-- Bills by group
CREATE INDEX idx_bills_group ON bills (group_id, created_at DESC);
```

### Custom SMTP

Supabase's default email sender has low deliverability. Configure custom SMTP:

**Resend (Recommended):**
- Free: 3,000 emails/mo, 100 emails/day
- $20/mo: 50,000 emails/mo

Setup: Supabase Dashboard → Authentication → SMTP Settings → Enter Resend SMTP credentials.

### Point-in-Time Recovery (PITR)

Available on Pro plan addon ($100/mo). Consider for launch only if handling real money. Daily backups (included in Pro) are sufficient initially.

### Connection Pooling

Use the Supabase connection pooler URL (port 6543) for serverless functions, not the direct connection (port 5432). The JS client (`@supabase/supabase-js`) uses HTTP/PostgREST so this isn't an issue, but if you ever add direct Postgres queries, use the pooler.

---

## 6. CI/CD Improvements

### Current CI

The project has tests (Vitest unit, Playwright E2E) and lint configured.

### Add Production Build Check

```yaml
build:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm ci
    - run: npm run build
      env:
        NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co"
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder"
```

This catches: broken imports, type errors in templates, SSR runtime errors, CSS/Tailwind compilation errors, and page-level export issues.

### Add Security Audit

```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm audit --audit-level=high
```

### Add Playwright E2E in CI

```yaml
e2e:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
      env:
        NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
        SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SERVICE_ROLE_KEY }}
        NEXT_PUBLIC_AUTH_PHONE_TEST_MODE: "true"
        CI: true
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
```

### GitHub Actions Free Tier

- 2,000 minutes/month (Linux) — generous for a small team
- Typical CI run: 3-5 min → ~400-600 runs/month

---

## 7. Performance Optimizations

### Bundle Size

`framer-motion` is the heaviest dependency. Use `LazyMotion` + `domAnimation` features to reduce its bundle:

```typescript
import { LazyMotion, domAnimation } from "framer-motion";

export function Providers({ children }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
```

This drops framer-motion from ~100KB to ~25KB.

### Image Optimization

Use `next/image` for:
- Google avatars (`*.googleusercontent.com`)
- Any user-facing images

Configure `remotePatterns` in `next.config.ts`.

### `optimizePackageImports`

Already configured for `lucide-react`. Consider adding:

```typescript
experimental: {
  optimizePackageImports: ["lucide-react", "framer-motion"],
},
```

### Database Query Optimization

- Use Supabase's `.select()` with specific columns instead of `select('*')`
- Add `.limit()` to list queries
- Use `.single()` for lookups that should return one row

---

## 8. PWA & Mobile Experience

### Why PWA?

Pagajaja is a mobile-first bill splitting app. A PWA provides:
- Add to home screen (looks like native app)
- Offline capability (view recent bills without network)
- Push notifications (future: payment reminders)

### Implementation with Serwist

[Serwist](https://github.com/serwist/serwist) is the modern successor to `next-pwa`. Free and open-source.

```bash
npm install @serwist/next serwist
```

Key files:
1. `public/manifest.json` — App metadata, icons, theme color
2. `src/app/sw.ts` — Service worker with caching strategies
3. `next.config.ts` — Wrap with `withSerwist()`

### Manifest Example

```json
{
  "name": "Pagajaja",
  "short_name": "Pagajaja",
  "description": "Divida contas com Pix",
  "start_url": "/app",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 9. LGPD Compliance

### What is LGPD?

Brazil's General Data Protection Law (Lei Geral de Proteção de Dados). Applies to any app processing data of Brazilian residents. Penalties: up to 2% of revenue or BRL 50 million per infraction.

### What Pagajaja Must Do

1. **Privacy Policy (Política de Privacidade)** — Required, in Portuguese. Must explain:
   - What data is collected (email, name, Google profile, Pix key)
   - Why (bill splitting, payment facilitation)
   - How it's stored (encrypted at rest, Supabase infrastructure)
   - How long it's retained
   - User rights (access, correction, deletion, portability)

2. **Consent** — Users must explicitly consent to data processing. The Google OAuth flow + onboarding can serve as consent if properly documented.

3. **Data Minimization** — Only collect what's necessary. The `user_profiles` view already limits exposed fields — good.

4. **Pix Key Handling** — Already well done:
   - AES-256-GCM encryption at rest ✅
   - Server-only decryption ✅
   - Masked hints for client display ✅

5. **Account Deletion** — Must provide a way for users to delete their account and all associated data. This is currently missing.

6. **Data Breach Notification** — Must notify ANPD (National Data Protection Authority) and affected users within a "reasonable time" of a breach.

### Implementation Priority

1. Add privacy policy page (`/politica-de-privacidade`)
2. Add account deletion flow (Settings → "Excluir conta")
3. Add data export (Settings → "Exportar meus dados")
4. Document data processing in Supabase (retention policies, backup encryption)

---

## 10. Free Tier Summary

### Services with Generous Free Tiers

| Service | Free Tier | Enough for Launch? |
|---------|-----------|--------------------|
| **Vercel** (Hobby) | 100 GB BW, 100 hrs serverless | ✅ Yes (non-commercial only) |
| **Supabase** (Free) | 500 MB DB, 1 GB storage | ⚠️ Auto-pauses after 7 days |
| **Sentry** (Developer) | 5K errors/mo, 1 user | ✅ Yes |
| **Upstash Redis** | 10K commands/day | ✅ Yes |
| **Resend** | 3K emails/mo, 100/day | ✅ Yes |
| **GitHub Actions** | 2,000 mins/mo (Linux) | ✅ Yes |
| **Cloudflare** (Free) | 100K req/day, 3 MiB bundle | ⚠️ Bundle limit tight |
| **Cloudflare** (Paid) | $5/mo — 10M req, 10 MiB | ✅ Yes |
| **Fly.io** | 3 shared VMs, 160 GB outbound | ✅ Yes |
| **Netlify** | 100 GB BW, 300 build mins | ✅ Yes |
| **Railway** | $5 free credit/mo (trial) | ⚠️ Trial only |
| **Render** | Static free, web services spin down | ⚠️ 30s+ cold starts |

### All-Free Stack ($0/mo)

| Layer | Service |
|-------|---------|
| Hosting | Vercel Hobby |
| Database | Supabase Free (⚠️ auto-pauses) |
| Monitoring | Sentry Developer |
| Rate limiting | Upstash Redis Free |
| Email | Resend Free |
| CI/CD | GitHub Actions Free |
| Testing | Playwright + Vitest (free) |
| PWA | Serwist (free) |

### Production Stack (~$45/mo)

| Layer | Service | Cost |
|-------|---------|------|
| Hosting | Vercel Pro | $20/mo |
| Database | Supabase Pro | $25/mo |
| Monitoring | Sentry Developer | $0 |
| Rate limiting | Upstash Redis | $0 |
| Email | Resend | $0 |
| CI/CD | GitHub Actions | $0 |
| **Total** | | **~$45/mo** |

### Self-Hosted Alternative (~$29/mo)

| Layer | Service | Cost |
|-------|---------|------|
| Hosting | Coolify on Hetzner CX22 | ~$4/mo |
| Database | Supabase Pro | $25/mo |
| Monitoring | Sentry Developer | $0 |
| Rate limiting | Upstash Redis | $0 |
| Email | Resend | $0 |
| **Total** | | **~$29/mo** |

---

## 11. Priority Roadmap

### Phase 1 — Ship Safely (Before Launch)

1. Add Sentry error monitoring
2. Add rate limiting to API routes (Upstash)
3. Hard-guard `/api/dev/login` with `NODE_ENV` check
4. Configure custom SMTP for auth emails (Resend)
5. Add CSP and security headers
6. Add database indexes for common queries
7. Add `npm run build` to CI pipeline
8. Add privacy policy page (LGPD)

### Phase 2 — Polish (First Month)

9. PWA manifest + service worker (Serwist)
10. Account deletion flow (LGPD)
11. Data export feature (LGPD)
12. Staging environment (separate Supabase project or Supabase branching)
13. Playwright E2E tests in CI
14. Bundle size optimization (lazy framer-motion)

### Phase 3 — Scale (As Needed)

15. Evaluate Cloudflare migration based on costs and OpenNext maturity
16. Move Pix QR generation to Supabase Edge Functions
17. Add Redis caching layer for hot data
18. Database PITR (if handling significant money)
19. Push notifications for payment reminders

---

## Sources

### Hosting
- [Vercel Pricing](https://vercel.com/pricing)
- [Vercel Hobby Plan Limits](https://vercel.com/docs/plans/hobby)
- [Vercel Pricing Breakdown 2026](https://schematichq.com/blog/vercel-pricing)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
- [Fly.io Pricing](https://fly.io/pricing/)
- [Coolify Self-Hosted](https://coolify.io/self-hosted)
- [Hetzner Cloud VPS](https://www.hetzner.com/cloud)
- [Netlify Pricing](https://www.netlify.com/pricing/)
- [Render Pricing](https://render.com/pricing)
- [Railway Pricing](https://docs.railway.com/pricing/plans)
- [10 Best Next.js Hosting Providers in 2026](https://makerkit.dev/blog/tutorials/best-hosting-nextjs)

### Cloudflare + OpenNext
- [OpenNext Cloudflare Adapter](https://opennext.js.org/cloudflare)
- [OpenNext Known Issues](https://opennext.js.org/cloudflare/known-issues)
- [OpenNext Troubleshooting](https://opennext.js.org/cloudflare/troubleshooting)
- [OpenNext Image Optimization](https://opennext.js.org/cloudflare/howtos/image)
- [OpenNext Caching](https://opennext.js.org/cloudflare/caching)
- [OpenNext GitHub](https://github.com/opennextjs/opennextjs-cloudflare)
- [Cloudflare Node.js Crypto Support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [Cloudflare Workers Size Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Next.js on Cloudflare: Rough Edges](https://nickb.dev/blog/nextjs-on-cloudflare-a-gem-with-rough-edges/)
- [Migrating Next.js 16 to Cloudflare](https://medium.com/@Yasirgaji/migrating-next-js-16-from-vercel-to-cloudflare-overcoming-the-25mb-limit-aa88e8396b29)
- [Cloudflare vs Vercel Comparison](https://getdeploying.com/cloudflare-vs-vercel)
- [Vercel vs Cloudflare 2026 Ranked](https://www.devtoolreviews.com/reviews/vercel-vs-netlify-vs-cloudflare-pages)
- [Cloudflare Rebuilt Next.js API](https://www.theregister.com/2026/02/25/cloudflare_nextjs_api_ai/)
- [Supabase + Cloudflare Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/)

### Monitoring & Observability
- [Sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
- [Sentry Pricing](https://sentry.io/pricing/)
- [OpenTelemetry in Next.js](https://nextjs.org/docs/app/guides/open-telemetry)
- [SigNoz OpenTelemetry Guide](https://signoz.io/blog/opentelemetry-nextjs/)
- [Structured Logging in Next.js](https://blog.arcjet.com/structured-logging-in-json-for-next-js/)

### Security
- [Next.js CSP Guide](https://nextjs.org/docs/app/guides/content-security-policy)
- [Upstash Rate Limiting](https://upstash.com/blog/nextjs-ratelimiting)
- [Upstash Redis Pricing](https://upstash.com/pricing/redis)

### Database
- [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase Pricing](https://supabase.com/pricing)
- [Supabase RLS Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend + Supabase](https://resend.com/docs/send-with-supabase-smtp)
- [Resend Pricing](https://resend.com/pricing)
- [Supabase Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase Branching](https://supabase.com/docs/guides/deployment/branching)

### PWA
- [Next.js PWA Guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Next.js 16 PWA with Serwist](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)
- [Serwist GitHub](https://github.com/serwist/serwist)

### LGPD
- [LGPD Compliance Guide for SaaS](https://complydog.com/blog/brazil-lgpd-complete-data-protection-compliance-guide-saas)
- [LGPD Compliance Checklist 2026](https://captaincompliance.com/education/lgpd-compliance-checklist/)
- [LGPD Privacy Policy Requirements](https://securiti.ai/blog/lgpd-privacy-policy/)

### CI/CD & Testing
- [GitHub Actions Billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [Playwright E2E with Next.js](https://enreina.com/blog/e2e-testing-in-next-js-with-playwright-vercel-and-github-actions-a-guide-with-example/)
- [E2E Testing with Playwright](https://makerkit.dev/blog/tutorials/playwright-testing)

### Performance
- [Framer Motion: Reduce Bundle Size](https://motion.dev/docs/react-reduce-bundle-size)
- [Next.js Package Bundling](https://nextjs.org/docs/app/guides/package-bundling)
