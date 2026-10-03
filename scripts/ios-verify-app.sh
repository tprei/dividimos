#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/ios-verify-app.sh <path/to/App.app>" >&2
}

if [ $# -ne 1 ] || [ ! -d "$1" ]; then
  usage
  exit 1
fi

APP="$1"
INFO="$APP/Info.plist"
CAP_CONFIG="$APP/capacitor.config.json"
failures=0

fail() {
  echo "error: $1" >&2
  failures=$((failures + 1))
}

# A missing key prints nothing and returns success, so the comparison that
# follows reports it as a mismatch instead of aborting the whole check.
plist_value() {
  plutil -extract "$1" raw -o - "$INFO" 2>/dev/null || return 0
}

[ "$(plist_value CFBundleIdentifier)" = "ai.dividimos.app" ] \
  || fail "CFBundleIdentifier is '$(plist_value CFBundleIdentifier)', expected ai.dividimos.app."
# The sign-in sheet ("… Wants to Use accounts.google.com to Sign In") shows
# CFBundleName, not the display name.
for key in CFBundleDisplayName CFBundleName; do
  [ "$(plist_value "$key")" = "Dividimos" ] \
    || fail "$key is '$(plist_value "$key")', expected Dividimos."
done

if plutil -extract NSAppTransportSecurity xml1 -o - "$INFO" >/dev/null 2>&1; then
  fail "Info.plist declares NSAppTransportSecurity; the app only loads https://www.dividimos.ai."
fi

for key in NSContactsUsageDescription NSLocationWhenInUseUsageDescription NSLocationAlwaysAndWhenInUseUsageDescription NSUserTrackingUsageDescription; do
  if [ -n "$(plist_value "$key")" ]; then
    fail "Info.plist declares $key, but no iOS feature requests that permission."
  fi
done

if [ ! -f "$CAP_CONFIG" ]; then
  fail "$CAP_CONFIG is missing; run 'npx cap sync ios' before building."
else
  node - "$CAP_CONFIG" <<'NODE' || failures=$((failures + 1))
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const problems = [];
if (config.server?.url !== "https://www.dividimos.ai") {
  problems.push(`server.url is ${JSON.stringify(config.server?.url)}; a dev sync was packaged.`);
}
if (config.server?.cleartext === true) problems.push("server.cleartext is true.");
if (config.server?.errorPath !== "offline.html") {
  problems.push(`server.errorPath is ${JSON.stringify(config.server?.errorPath)}, expected offline.html.`);
}
if (config.ios?.webContentsDebuggingEnabled === true) {
  problems.push("ios.webContentsDebuggingEnabled is true.");
}
for (const problem of problems) console.error(`error: capacitor.config.json ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
NODE
fi

[ -f "$APP/public/offline.html" ] || fail "public/offline.html is missing from the bundle."

if [ -d "$APP/Frameworks" ]; then
  for forbidden in FBSDKCoreKit FBSDKLoginKit FacebookCore FacebookLogin CapacitorCommunityContacts; do
    if [ -e "$APP/Frameworks/$forbidden.framework" ]; then
      fail "$forbidden.framework is embedded; it is disabled for iOS."
    fi
  done
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures release configuration problem(s) in $APP." >&2
  exit 1
fi
echo "Release configuration OK: $APP"
