# Capacitor integration plan for Dividimos

Date: 2026-04-02
Status: Draft
Author: Technical Architect

## Executive summary

Dividimos is a server-rendered Next.js 16 app with API routes, server actions, middleware, and Google OAuth. Capacitor wraps a WebView around static files. These two models are fundamentally incompatible without an architectural pivot: **the Capacitor shell cannot run Node.js server code**.

The recommended approach is a **"thin shell" Capacitor wrapper** that points its WebView at the deployed production URL (or a dev server during development), rather than attempting a static export. This preserves 100% of the existing server-side architecture -- API routes, middleware, server actions, SSR, cookies -- while giving the app native distribution on Google Play and the App Store, plus access to native Capacitor plugins for push notifications, status bar, splash screen, and deep links.

The alternative (static export) would require rewriting every server action into an API route, converting all API routes to call a remote backend, replacing the middleware auth flow, replacing `next/image` with a custom loader, and abandoning SSR. That is a 3-4 week refactor with high regression risk and no functional benefit -- the app already requires internet connectivity to talk to Supabase.

---

## Table of contents

1. [Architecture decision: remote URL vs. static export](#1-architecture-decision)
2. [Packages to install](#2-packages-to-install)
3. [Project structure](#3-project-structure)
4. [Capacitor configuration](#4-capacitor-configuration)
5. [Native project setup](#5-native-project-setup)
6. [OAuth flow in the WebView](#6-oauth-flow-in-the-webview)
7. [Push notifications migration](#7-push-notifications-migration)
8. [Service worker handling](#8-service-worker-handling)
9. [Status bar and safe area](#9-status-bar-and-safe-area)
10. [Splash screen and icons](#10-splash-screen-and-icons)
11. [Deep links and universal links](#11-deep-links-and-universal-links)
12. [Build pipeline](#12-build-pipeline)
13. [Local dev workflow](#13-local-dev-workflow)
14. [Implementation phases](#14-implementation-phases)
15. [Risk register](#15-risk-register)
16. [Open questions](#16-open-questions)

---

## 1. Architecture decision

### Why static export does not work for this codebase

Next.js `output: 'export'` produces a directory of static HTML/JS/CSS files. It explicitly does not support:

- **Route Handlers that read the request** (all 8 of ours do: `/api/pix/generate`, `/api/push/*`, `/api/receipt/*`, `/api/users/lookup`, `/api/dev/login`, `/auth/callback`)
- **Server Actions** (`src/app/auth/onboard/actions.ts`, `src/app/app/profile/actions.ts`, `src/lib/supabase/debt-actions.ts`, `src/lib/push/push-notify.ts`)
- **Middleware** (`src/lib/supabase/middleware.ts` -- handles auth gating, cookie refresh)
- **`cookies()` from `next/headers`** (used in `src/lib/supabase/server.ts`)
- **`next/image` default loader** (used in `src/components/shared/user-avatar.tsx`)
- **Dynamic routes without `generateStaticParams`** (`src/app/app/groups/[id]/page.tsx`, `src/app/app/bill/[id]/page.tsx`)

Attempting static export would require:

| Component | Required change | Effort |
|-----------|----------------|--------|
| 8 API routes | Rehost as standalone API or Supabase Edge Functions | 1-2 weeks |
| 4 server action files | Convert to client-side fetch calls to new API | 3-5 days |
| Middleware auth | Replace with client-side route guard in every layout | 2-3 days |
| Supabase server client | Rewrite to use browser client everywhere | 2-3 days |
| `next/image` | Custom loader or replace with `<img>` | 1 day |
| Dynamic routes | Add `generateStaticParams` stubs (won't work for user data) | N/A -- blocked |
| Crypto (AES-256-GCM) | Move all encryption to Supabase Edge Functions | 1 week |

**Total estimated effort for static export path: 3-4 weeks** with high regression risk.

### Recommended: remote URL shell

Capacitor supports pointing the WebView at a remote URL via `server.url` in the config. The WebView loads `https://dividimos.ai` (or your production domain) just like a browser -- but inside a native app container with access to Capacitor plugins.

Advantages:
- Zero changes to existing server-side code
- All API routes, middleware, server actions, and SSR work unchanged
- OTA updates -- deploy to your server, the app picks up changes immediately
- App Store review is simpler (the app is just a WebView, but with native integrations)
- Implementation timeline: 1-2 weeks

Trade-offs:
- The app requires internet connectivity (it already does -- every action hits Supabase)
- App Store reviewers sometimes scrutinize "thin wrapper" apps. Mitigation: the native push notifications, splash screen, status bar integration, and deep links provide enough native behavior to pass review. Apple's guideline 4.2 (Minimum Functionality) targets apps that are "simply a web site bundled as an app" with no native features. Our native integrations (FCM/APNs push, biometric potential, deep links) differentiate it
- Slightly slower initial load vs. local static files (mitigated by splash screen)

### Hybrid option for the future

If offline support becomes a requirement, a middle path exists: use `output: 'export'` for a subset of pages (landing, demo, offline shell) and load authenticated routes from the remote server. This requires significant router surgery and is not recommended for the initial release.

---

## 2. Packages to install

### Production dependencies

```bash
npm install @capacitor/core @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/push-notifications @capacitor/keyboard @capacitor/browser @capacitor/haptics
```

| Package | Purpose |
|---------|---------|
| `@capacitor/core` | Capacitor runtime, bridge between JS and native |
| `@capacitor/app` | App lifecycle events (back button, state changes, URL open) |
| `@capacitor/status-bar` | Control status bar color/style to match theme |
| `@capacitor/splash-screen` | Native splash while WebView loads remote URL |
| `@capacitor/push-notifications` | FCM (Android) and APNs (iOS) native push |
| `@capacitor/keyboard` | Keyboard show/hide events for input handling |
| `@capacitor/browser` | Open external URLs in system browser (for OAuth) |
| `@capacitor/haptics` | Tactile feedback on settlements, confirmations |

### Dev dependencies

```bash
npm install -D @capacitor/cli @capacitor/assets
```

| Package | Purpose |
|---------|---------|
| `@capacitor/cli` | `npx cap init`, `npx cap add`, `npx cap sync`, `npx cap run` |
| `@capacitor/assets` | Generate splash screens and icons from source images |

---

## 3. Project structure

```
pixwise/
  capacitor.config.ts          # Capacitor configuration
  android/                     # Generated Android project (committed to git)
  ios/                         # Generated iOS project (committed to git)
  resources/                   # Source images for icon/splash generation
    icon.png                   # 1024x1024 app icon source
    icon-foreground.png        # 1024x1024 adaptive icon foreground
    icon-background.png        # 1024x1024 adaptive icon background
    splash.png                 # 2732x2732 splash screen source
    splash-dark.png            # 2732x2732 splash screen dark mode
  src/
    lib/
      capacitor/
        index.ts               # Platform detection + initialization
        push.ts                # Native push notification registration
        status-bar.ts          # Status bar configuration
        keyboard.ts            # Keyboard event handling
        deep-links.ts          # Universal/App Link handling
    components/
      pwa/
        register-sw.tsx        # Modified: skip SW on native, init Capacitor
  scripts/
    cap-dev.sh                 # Dev workflow: start dev server + open native IDE
```

### Git tracking

Both `android/` and `ios/` directories should be committed to the repository. This is the Capacitor team's recommendation -- native projects contain configuration, signing setup, and plugin-specific code that must be version-controlled. Add these entries to `.gitignore` for build artifacts only:

```gitignore
# Capacitor native build artifacts
android/app/build/
android/.gradle/
android/build/
ios/App/Pods/
ios/DerivedData/
```

---

## 4. Capacitor configuration

### `capacitor.config.ts`

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const devMode = process.env.CAPACITOR_DEV === 'true';

const config: CapacitorConfig = {
  appId: 'ai.dividimos.app',
  appName: 'Dividimos',
  webDir: 'out',

  server: {
    url: devMode
      ? 'http://YOUR_LAN_IP:3000'
      : 'https://dividimos.ai',
    cleartext: devMode,
  },

  android: {
    allowMixedContent: false,
    backgroundColor: '#F9F9FB',
    buildOptions: {
      releaseType: 'AAB',
    },
  },

  ios: {
    scheme: 'Dividimos',
    backgroundColor: '#F9F9FB',
    contentInset: 'automatic',
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#F9F9FB',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      launchFadeOutDuration: 300,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#F9F9FB',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
```

### Key decisions

- **`webDir: 'out'`**: Still required by Capacitor even for remote URL mode. It copies a minimal fallback page to the native project. We create a small `out/index.html` that shows a loading state or redirects to the remote URL. This directory is only used when `server.url` is not set
- **`server.url`**: Points at the deployed production URL. The WebView loads from this URL on every launch
- **`cleartext: true`** only in dev mode (Android requires this for non-HTTPS connections to the dev server)
- **`launchAutoHide: false`**: We manually hide the splash screen from JS once the page has loaded, preventing a flash of white screen while the remote URL loads

---

## 5. Native project setup

### Android-specific setup

After `npx cap add android`:

1. **Minimum SDK**: Set `minSdkVersion 24` (Android 7.0) in `android/app/build.gradle`. Covers 97%+ of active Android devices in Brazil
2. **Internet permission**: Already included by default in Capacitor Android projects
3. **Google Services**: Required for FCM push notifications. Add `google-services.json` from Firebase Console to `android/app/`
4. **App signing**: Use Play App Signing (Google manages the upload key). Generate an upload keystore for local builds
5. **Edge-to-edge**: Consider `adjustMarginsForEdgeToEdge: 'auto'` in the Capacitor config for Android 15+ where edge-to-edge is enforced

### iOS-specific setup

After `npx cap add ios`:

1. **Deployment target**: iOS 16.0 minimum (aligns with Capacitor 7 requirement, covers 95%+ of active iOS devices in Brazil)
2. **Push capability**: Add Push Notifications capability in Xcode. Upload APNs auth key to Firebase
3. **Associated Domains**: Add `applinks:dividimos.ai` for Universal Links
4. **App Transport Security**: No changes needed -- we load from HTTPS in production
5. **Info.plist**: Camera usage description for QR scanning (`NSCameraUsageDescription`)

---

## 6. OAuth flow in the WebView

This is the most critical integration point. Currently, Google OAuth is initiated via:

```typescript
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: `${window.location.origin}/auth/callback?next=...`,
  },
});
```

### The problem

Supabase's `signInWithOAuth` opens a browser redirect to Google's OAuth consent screen. In a Capacitor WebView:

1. The redirect goes to `accounts.google.com` inside the WebView
2. Google may block sign-in from embedded WebViews (Google's OAuth policy prohibits WebView-based OAuth for security reasons)
3. Even if it works, the redirect back to `https://dividimos.ai/auth/callback` must be intercepted by the WebView

### Solution: use `@capacitor/browser` for OAuth

Open the OAuth flow in the system browser (Chrome Custom Tab on Android, SFSafariViewController on iOS), which Google explicitly allows. The flow:

1. App detects it is running in Capacitor (`Capacitor.isNativePlatform()`)
2. Instead of in-WebView redirect, call `Browser.open({ url: oauthUrl })` to open the system browser
3. After Google auth, Supabase redirects to `https://dividimos.ai/auth/callback?code=...`
4. The server exchanges the code for a session (existing code works unchanged)
5. The callback page sets cookies and redirects to `/app`
6. Use a deep link (`dividimos://auth/callback`) or Universal Link to return the user to the native app
7. The Capacitor WebView reloads and picks up the session cookies

### Implementation

Create `src/lib/capacitor/auth.ts`:

```typescript
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function openOAuthInSystemBrowser(oauthUrl: string): Promise<void> {
  await Browser.open({
    url: oauthUrl,
    presentationStyle: 'fullscreen',
  });
}
```

Modify the auth page to detect native platform and use the system browser:

```typescript
const handleGoogleSignIn = async () => {
  const { data } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      skipBrowserRedirect: isNativePlatform(),
    },
  });

  if (isNativePlatform() && data?.url) {
    await openOAuthInSystemBrowser(data.url);
  }
};
```

The `skipBrowserRedirect: true` option tells Supabase to return the OAuth URL instead of navigating to it. We then open it in the system browser ourselves.

### Returning to the app after OAuth

After the callback completes on the server, redirect to a URL that the native app can intercept:

- **Android**: App Link (`https://dividimos.ai/auth/callback-complete`) configured in `AndroidManifest.xml`
- **iOS**: Universal Link (same URL, configured via `apple-app-site-association`)

The `@capacitor/app` plugin listens for URL open events:

```typescript
import { App } from '@capacitor/app';

App.addListener('appUrlOpen', ({ url }) => {
  if (url.includes('/auth/callback-complete')) {
    Browser.close();
    // WebView reloads to pick up the new session
    window.location.href = '/app';
  }
});
```

---

## 7. Push notifications migration

### Current architecture

- Web Push via VAPID keys (`web-push` npm package)
- Service worker receives push events and shows notifications
- Subscriptions are encrypted with AES-256-GCM and stored in `push_subscriptions` table
- Server-side `notifyUser()` decrypts subscriptions and calls `webpush.sendNotification()`

### Native push architecture

On native platforms, push notifications use FCM (Android) and APNs (iOS), not Web Push. Capacitor's `@capacitor/push-notifications` plugin handles registration and token management.

### Migration strategy (dual-stack)

Keep Web Push for the PWA. Add native push for Capacitor builds. The server dispatches to whichever channel(s) the user has registered.

#### Database changes

Add columns to `push_subscriptions` to distinguish transport type:

```sql
ALTER TABLE push_subscriptions
  ADD COLUMN transport TEXT NOT NULL DEFAULT 'web_push'
    CHECK (transport IN ('web_push', 'fcm', 'apns')),
  ADD COLUMN device_token TEXT;
```

- `transport = 'web_push'`: existing behavior, `subscription` column holds encrypted Web Push subscription JSON
- `transport = 'fcm'`: `device_token` holds the FCM registration token (not encrypted -- FCM tokens are not sensitive)
- `transport = 'apns'`: `device_token` holds the APNs device token

#### Client-side registration (native)

Create `src/lib/capacitor/push.ts`:

```typescript
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export async function registerNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') return;

  await PushNotifications.register();

  PushNotifications.addListener('registration', async (token) => {
    const platform = Capacitor.getPlatform(); // 'android' | 'ios'
    const transport = platform === 'android' ? 'fcm' : 'apns';

    await fetch('/api/push/register-native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transport,
        deviceToken: token.value,
      }),
    });
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url;
    if (url) {
      window.location.href = url;
    }
  });
}
```

#### New API route: `/api/push/register-native`

```typescript
export async function POST(request: Request) {
  // Authenticate user via Supabase session cookie
  // Validate transport is 'fcm' or 'apns'
  // Upsert into push_subscriptions with device_token and transport
  // Delete any existing subscription for same user + device_token (prevent duplicates)
}
```

#### Server-side dispatch

Modify `notifyUser()` to check the `transport` column and dispatch accordingly:

- `web_push`: existing `webpush.sendNotification()` path
- `fcm`: send via Firebase Admin SDK (`firebase-admin` package, new dependency)
- `apns`: FCM can send to APNs devices too via the FCM HTTP v1 API, so no separate APNs integration needed

New dependency: `firebase-admin` (server-side only, for sending FCM messages).

```bash
npm install firebase-admin
```

---

## 8. Service worker handling

### Current service worker behavior

`public/sw.js` provides:
- Offline fallback page (`/offline.html`)
- Runtime caching for same-origin assets
- Web Push event handling (`push`, `notificationclick`)
- Precaching of icons

### Changes needed

The service worker should **not** be registered when running inside Capacitor. Reasons:

1. Capacitor loads from a remote URL -- the SW would cache responses and create stale-content issues
2. Push notifications on native are handled by FCM/APNs, not the SW's `push` event
3. The offline fallback is irrelevant in a native app context (the splash screen serves this purpose)

### Implementation

Modify `src/components/pwa/register-sw.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export function RegisterSW() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // Skip service worker registration on native platforms.
      // Unregister any previously registered SW to avoid stale caches.
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
        });
      }
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
```

This change is backward-compatible -- on the web, behavior is unchanged. On native, the SW is skipped.

---

## 9. Status bar and safe area

### Status bar

Create `src/lib/capacitor/status-bar.ts`:

```typescript
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function configureStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await StatusBar.setStyle({ style: Style.Light });

  if (Capacitor.getPlatform() === 'android') {
    await StatusBar.setBackgroundColor({ color: '#F9F9FB' });
  }

  await StatusBar.setOverlaysWebView({ overlay: true });
}
```

### Safe area insets

The app uses `display: fullscreen` in its manifest and has `viewport-fit=cover` behavior. On iOS, the notch and home indicator overlap content. Capacitor sets CSS environment variables (`env(safe-area-inset-top)`, etc.) automatically.

Add safe area padding to the root layout and any fixed/sticky elements:

```css
/* globals.css */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

Audit all components with `fixed` or `sticky` positioning and ensure they respect safe area insets. Key candidates:
- Bottom navigation bars
- Fixed-position modals
- The Toaster component (positioned `top-center`)

---

## 10. Splash screen and icons

### Source images needed

| File | Dimensions | Purpose |
|------|-----------|---------|
| `resources/icon.png` | 1024x1024 | Standard app icon |
| `resources/icon-foreground.png` | 1024x1024 | Android adaptive icon foreground (with transparent background) |
| `resources/icon-background.png` | 1024x1024 | Android adaptive icon background (solid color or pattern) |
| `resources/splash.png` | 2732x2732 | Splash screen, centered logo on `#F9F9FB` background |
| `resources/splash-dark.png` | 2732x2732 | Splash screen dark variant on `#09243f` background |

### Generation command

```bash
npx @capacitor/assets generate --iconBackgroundColor '#F9F9FB' --splashBackgroundColor '#F9F9FB' --splashBackgroundColorDark '#09243f'
```

This generates all required sizes for both platforms from the source images in `resources/`.

### Manual splash screen dismissal

Since we set `launchAutoHide: false`, the splash stays visible until we dismiss it. Add to the Capacitor initialization:

```typescript
import { SplashScreen } from '@capacitor/splash-screen';

// Call once the page has rendered
export async function hideSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
```

Call `hideSplash()` from the root layout's `useEffect` or from the app shell component that renders after the initial data load.

---

## 11. Deep links and universal links

### Purpose

1. Return to the app after OAuth in the system browser
2. Handle invite links (`https://dividimos.ai/join/...`) to open directly in the app
3. Handle claim links (`https://dividimos.ai/claim/...`)

### Android: App Links

In `android/app/src/main/AndroidManifest.xml`, inside the `<activity>` tag:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="dividimos.ai" />
</intent-filter>
```

Host a `/.well-known/assetlinks.json` on the production domain:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "ai.dividimos.app",
    "sha256_cert_fingerprints": ["<SHA256_OF_SIGNING_CERT>"]
  }
}]
```

### iOS: Universal Links

Add Associated Domains capability in Xcode: `applinks:dividimos.ai`.

Host `/.well-known/apple-app-site-association` on the production domain:

```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appIDs": ["<TEAM_ID>.ai.dividimos.app"],
      "paths": ["/join/*", "/claim/*", "/auth/callback-complete"]
    }]
  }
}
```

### Next.js route for well-known files

Create a static route handler that serves these files. Since we are using remote URL mode, these need to be served by the Next.js server:

```
src/app/.well-known/assetlinks.json/route.ts
src/app/.well-known/apple-app-site-association/route.ts
```

These are simple `GET` handlers that return static JSON with the correct `Content-Type`.

---

## 12. Build pipeline

### Development builds

```bash
# Terminal 1: start Next.js dev server bound to all interfaces
HOST=0.0.0.0 npm run dev

# Terminal 2: sync and run on device/emulator
CAPACITOR_DEV=true npx cap sync android
npx cap run android
# or
CAPACITOR_DEV=true npx cap sync ios
npx cap run ios
```

### Production builds

#### Android (AAB for Play Store)

```bash
# 1. Ensure production server.url in capacitor.config.ts
npx cap sync android

# 2. Build the AAB
cd android && ./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

#### iOS (IPA for App Store)

```bash
npx cap sync ios
# Open Xcode, archive, and upload via Xcode Organizer
npx cap open ios
```

### NPM scripts to add

```json
{
  "scripts": {
    "cap:sync": "npx cap sync",
    "cap:dev:android": "CAPACITOR_DEV=true npx cap sync android && npx cap run android",
    "cap:dev:ios": "CAPACITOR_DEV=true npx cap sync ios && npx cap run ios",
    "cap:open:android": "npx cap open android",
    "cap:open:ios": "npx cap open ios",
    "cap:assets": "npx @capacitor/assets generate --iconBackgroundColor '#F9F9FB' --splashBackgroundColor '#F9F9FB' --splashBackgroundColorDark '#09243f'"
  }
}
```

### CI/CD considerations

- Android builds can run in CI with the Android SDK. Use GitHub Actions with `setup-java` and `setup-android` actions
- iOS builds require a macOS runner. Use GitHub Actions macOS runners or a service like Codemagic/Bitrise
- The `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) should be injected as CI secrets, not committed to the repo
- Signing keys should be managed via CI secrets (upload keystore for Android, certificates/provisioning profiles for iOS)

---

## 13. Local dev workflow

### Prerequisites

- **Android**: Android Studio with SDK 34+, an emulator or physical device with USB debugging
- **iOS**: Xcode 15+ (macOS only), a simulator or physical device with a provisioning profile

### Step-by-step dev loop

1. Start the Next.js dev server:
   ```bash
   npm run dev
   ```

2. Find your LAN IP:
   ```bash
   # macOS
   ipconfig getifaddr en0
   # Linux
   hostname -I | awk '{print $1}'
   ```

3. Update `capacitor.config.ts` server URL (or use the `CAPACITOR_DEV` env var pattern):
   ```
   server.url = "http://192.168.1.X:3000"
   ```

4. Sync and run:
   ```bash
   CAPACITOR_DEV=true npx cap sync android
   npx cap run android --target <device-id>
   ```

5. Changes to the web code are reflected immediately in the WebView (it is loading from the dev server, which has HMR). No need to rebuild or re-sync for JS/CSS changes.

6. **When to re-sync**: Only when you change `capacitor.config.ts`, add/remove a Capacitor plugin, or modify native project files.

### Script: `scripts/cap-dev.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${1:-android}"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo "Using LAN IP: $LAN_IP"
echo "Starting dev server..."

CAPACITOR_DEV=true npx cap sync "$PLATFORM"

echo ""
echo "Dev server URL: http://$LAN_IP:3000"
echo "Opening $PLATFORM project..."

npx cap open "$PLATFORM"

echo ""
echo "Make sure 'npm run dev' is running in another terminal."
echo "The WebView will load from http://$LAN_IP:3000"
```

---

## 14. Implementation phases

### Phase 1: Capacitor shell (3-4 days)

**Goal**: App launches in a native shell, loads from production URL, has splash screen.

Files to create:
- `capacitor.config.ts`
- `resources/icon.png`, `resources/icon-foreground.png`, `resources/icon-background.png`, `resources/splash.png`, `resources/splash-dark.png`
- `src/lib/capacitor/index.ts`
- `src/lib/capacitor/status-bar.ts`
- `scripts/cap-dev.sh`
- `out/index.html` (minimal fallback)

Files to modify:
- `package.json` (add dependencies and scripts)
- `.gitignore` (add native build artifact patterns)
- `src/components/pwa/register-sw.tsx` (skip SW on native)
- `src/app/layout.tsx` (add Capacitor init, safe area CSS)
- `src/app/globals.css` (safe area inset padding)

Commands:
```bash
npm install @capacitor/core @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard @capacitor/browser @capacitor/haptics
npm install -D @capacitor/cli @capacitor/assets
npx cap init Dividimos ai.dividimos.app --web-dir out
npx cap add android
npx cap add ios
npx @capacitor/assets generate ...
npx cap sync
```

**Validation**: App opens on Android emulator, shows splash screen, loads the production website in the WebView. Status bar colors match the theme.

### Phase 2: OAuth in system browser (2-3 days)

**Goal**: Google sign-in works correctly in the native app.

Files to create:
- `src/lib/capacitor/auth.ts`
- `src/app/.well-known/assetlinks.json/route.ts`
- `src/app/.well-known/apple-app-site-association/route.ts`

Files to modify:
- `src/app/auth/page.tsx` (use system browser for OAuth on native)
- `src/app/auth/callback/route.ts` (redirect to app after callback)
- `android/app/src/main/AndroidManifest.xml` (App Links intent filter)
- `ios/App/App/Info.plist` (Associated Domains)
- `src/lib/capacitor/index.ts` (add URL open listener)

**Validation**: Tap "Entrar com Google" in the native app, system browser opens Google consent, after approval user returns to the app authenticated.

### Phase 3: Native push notifications (3-4 days)

**Goal**: Native push notifications via FCM/APNs replace Web Push on native platforms.

Files to create:
- `src/lib/capacitor/push.ts`
- `src/app/api/push/register-native/route.ts`
- Database migration for `transport` and `device_token` columns

Files to modify:
- `src/lib/push/notify-user.ts` (add FCM dispatch path)
- `src/lib/push/web-push.ts` (keep for web, add FCM alternative)
- `src/components/pwa/register-sw.tsx` (init native push on Capacitor)

New dependencies:
```bash
npm install firebase-admin
```

**Validation**: Native app receives push notification when another user sends a settlement request. Tapping the notification opens the correct screen.

### Phase 4: Deep links and polish (2-3 days)

**Goal**: Invite links and claim links open directly in the app. Back button works correctly on Android.

Files to create:
- `src/lib/capacitor/deep-links.ts`

Files to modify:
- `src/lib/capacitor/index.ts` (wire up deep link handler, back button handler)
- Deploy well-known files to production domain

**Validation**:
- Tap an invite link (`https://dividimos.ai/join/...`) on a phone with the app installed, app opens to the invite page
- Android back button navigates back within the app or exits gracefully
- OAuth flow returns to the app via deep link

### Phase 5: Store submission (2-3 days)

**Goal**: App is submitted to Google Play and Apple App Store.

Tasks:
- Create Google Play Developer account ($25 one-time)
- Create Apple Developer account ($99/year)
- Prepare store listings (screenshots, descriptions in Portuguese)
- Generate signed AAB for Android
- Archive and upload IPA for iOS
- Configure app review notes explaining the native integrations

---

## 15. Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Apple rejects "thin wrapper" app (guideline 4.2) | High | Medium | Add native push, haptics, deep links, splash screen. Document native features in review notes. If rejected, add biometric lock or widget |
| Google blocks OAuth in WebView | High | Low | Already mitigated by using system browser via `@capacitor/browser` |
| Session cookies not shared between system browser and WebView | High | Medium | Use deep links to pass auth token, or use Supabase's `signInWithIdToken` pattern |
| Capacitor 7 does not support Next.js 16 features | Medium | Low | We are not using Capacitor's web build pipeline -- just pointing at a URL. Framework version is irrelevant |
| WebView performance on low-end Android devices | Medium | Medium | Set `minWebViewVersion: 80` to exclude very old Chrome WebViews. The app is already optimized for mobile |
| Push notification token rotation | Low | Medium | Re-register on every app launch, upsert by device token to handle rotation |
| SSL certificate pinning requirements for app stores | Low | Low | Not required by either store. Can add later if needed |

---

## 16. Open questions

These need resolution before implementation begins:

1. **Production domain**: Is the production URL `https://dividimos.ai` or something else? The Capacitor config and deep link configuration depend on this

2. **Firebase project**: Does a Firebase project exist for Dividimos? If not, one needs to be created to get `google-services.json` and `GoogleService-Info.plist` for push notifications

3. **Apple Developer account**: Is there an existing Apple Developer account? The Team ID is needed for Universal Links configuration

4. **Icon assets**: The existing `icon-512.png` and `icon-maskable-512.png` may need to be upscaled or re-exported at 1024x1024 for the `resources/` directory. Who produces the final icon assets?

5. **Cookie sharing between system browser and WebView**: This is platform-specific. On iOS, SFSafariViewController shares cookies with Safari. On Android, Chrome Custom Tabs share cookies with Chrome. Need to verify that Supabase session cookies are carried over correctly, or implement a token-passing alternative

6. **Store listing content**: Who provides the Portuguese store descriptions, screenshots, and promotional graphics?

7. **Release cadence**: Should the native app have its own version number scheme, or track the web app's version? Capacitor uses the native project's version number for store submissions

8. **Analytics**: Should the native app report that sessions originate from the native app (vs. mobile web)? If so, add a user-agent suffix or a query parameter to the URL

---

## Appendix A: files changed summary

### New files (Phase 1-4)

| File | Phase | Purpose |
|------|-------|---------|
| `capacitor.config.ts` | 1 | Capacitor project configuration |
| `resources/icon.png` | 1 | App icon source (1024x1024) |
| `resources/icon-foreground.png` | 1 | Android adaptive icon foreground |
| `resources/icon-background.png` | 1 | Android adaptive icon background |
| `resources/splash.png` | 1 | Splash screen source |
| `resources/splash-dark.png` | 1 | Splash screen dark mode source |
| `out/index.html` | 1 | Minimal fallback for Capacitor webDir |
| `src/lib/capacitor/index.ts` | 1 | Platform detection, initialization |
| `src/lib/capacitor/status-bar.ts` | 1 | Status bar color/style |
| `src/lib/capacitor/auth.ts` | 2 | OAuth system browser flow |
| `src/lib/capacitor/deep-links.ts` | 4 | Universal/App link handling |
| `src/lib/capacitor/push.ts` | 3 | Native push registration |
| `src/lib/capacitor/keyboard.ts` | 1 | Keyboard event handling |
| `src/app/.well-known/assetlinks.json/route.ts` | 2 | Android App Links verification |
| `src/app/.well-known/apple-app-site-association/route.ts` | 2 | iOS Universal Links verification |
| `src/app/api/push/register-native/route.ts` | 3 | Native push token registration |
| `scripts/cap-dev.sh` | 1 | Dev workflow helper |
| `android/` | 1 | Generated Android project |
| `ios/` | 1 | Generated iOS project |

### Modified files

| File | Phase | Change |
|------|-------|--------|
| `package.json` | 1 | Add Capacitor dependencies and scripts |
| `.gitignore` | 1 | Add native build artifact patterns |
| `src/components/pwa/register-sw.tsx` | 1 | Skip SW on native, init Capacitor |
| `src/app/layout.tsx` | 1 | Add Capacitor init hook, safe area meta |
| `src/app/globals.css` | 1 | Safe area inset padding |
| `src/app/auth/page.tsx` | 2 | System browser OAuth on native |
| `src/app/auth/callback/route.ts` | 2 | Deep link redirect after OAuth |
| `src/lib/push/notify-user.ts` | 3 | Dual-stack dispatch (Web Push + FCM) |

### Database migrations (Phase 3)

| Migration | Purpose |
|-----------|---------|
| `*_add_push_transport_columns.sql` | Add `transport` and `device_token` to `push_subscriptions` |

---

## Appendix B: dependency impact

### New production dependencies (7 packages)

| Package | Size (approx) | Tree-shakeable | Server/Client |
|---------|--------------|----------------|---------------|
| `@capacitor/core` | ~50KB | Yes (no-op on web) | Client |
| `@capacitor/app` | ~8KB | Yes | Client |
| `@capacitor/status-bar` | ~5KB | Yes | Client |
| `@capacitor/splash-screen` | ~6KB | Yes | Client |
| `@capacitor/push-notifications` | ~10KB | Yes | Client |
| `@capacitor/keyboard` | ~5KB | Yes | Client |
| `@capacitor/browser` | ~5KB | Yes | Client |
| `@capacitor/haptics` | ~4KB | Yes | Client |
| `firebase-admin` | ~2MB | No | Server only |

`firebase-admin` is server-only and will not affect client bundle size. The Capacitor client packages are tree-shakeable and only add meaningful code paths when `Capacitor.isNativePlatform()` returns true.

### New dev dependencies (2 packages)

| Package | Purpose |
|---------|---------|
| `@capacitor/cli` | CLI tooling for sync, add, run |
| `@capacitor/assets` | Icon and splash screen generation |

---

## Appendix C: why not Expo or React Native?

Expo and React Native would require rewriting the entire frontend in React Native components. The existing Next.js codebase with Tailwind CSS, Framer Motion, and server-side rendering would be abandoned. Capacitor wraps the existing web app with minimal changes.

Capacitor is the correct tool when:
- The web app is the primary product and should remain the single codebase
- Native distribution (app stores) is the goal, not native UI components
- The app is already designed for mobile-first (this one is)
- The team's expertise is web, not native mobile

If the project eventually needs features that are impossible in a WebView (complex gestures, native map integrations, AR, etc.), a React Native migration could be considered at that point. For now, Capacitor is the right fit.
