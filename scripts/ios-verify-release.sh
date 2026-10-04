#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/ios-verify-release.sh <path/to/Dividimos.ipa> <marketing-version> <build-number> <team-id> <app-id-prefix>" >&2
}

if [ $# -ne 5 ]; then
  usage
  exit 1
fi
if [ ! -f "$1" ]; then
  echo "error: $1 does not exist; xcodebuild -exportArchive names the IPA after the scheme." >&2
  exit 1
fi

IPA="$1"
EXPECTED_MARKETING="$2"
EXPECTED_BUILD="$3"
TEAM_ID="$4"
APP_ID_PREFIX="$5"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

unzip -q "$IPA" -d "$WORK"
APP="$(find "$WORK/Payload" -maxdepth 1 -name '*.app' -type d | head -n 1)"
if [ -z "$APP" ]; then
  echo "error: $IPA has no Payload/*.app." >&2
  exit 1
fi

"$SCRIPT_DIR/ios-verify-app.sh" "$APP"

INFO="$APP/Info.plist"
failures=0

fail() {
  echo "error: $1" >&2
  failures=$((failures + 1))
}

# A missing key prints nothing and returns success, so the comparison that
# follows reports it as a mismatch instead of aborting the whole check.
plist_value() {
  plutil -extract "$2" raw -o - "$1" 2>/dev/null || return 0
}

# plutil treats dots as key separators, so reverse-DNS keys need PlistBuddy.
plist_entry() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || return 0
}

[ "$(plist_value "$INFO" CFBundleShortVersionString)" = "$EXPECTED_MARKETING" ] \
  || fail "CFBundleShortVersionString is '$(plist_value "$INFO" CFBundleShortVersionString)', expected $EXPECTED_MARKETING."
[ "$(plist_value "$INFO" CFBundleVersion)" = "$EXPECTED_BUILD" ] \
  || fail "CFBundleVersion is '$(plist_value "$INFO" CFBundleVersion)', expected $EXPECTED_BUILD."

URL_TYPES="$(plutil -extract CFBundleURLTypes xml1 -o - "$INFO" 2>/dev/null || true)"
if ! grep -Eq '<string>com\.googleusercontent\.apps\.[0-9]+-[a-z0-9]+</string>' <<< "$URL_TYPES"; then
  fail "CFBundleURLTypes has no Google sign-in scheme (com.googleusercontent.apps.<id>); set GOOGLE_IOS_URL_SCHEME."
fi

FIREBASE="$APP/GoogleService-Info.plist"
if [ ! -f "$FIREBASE" ]; then
  fail "GoogleService-Info.plist is missing; push registration cannot work."
elif [ "$(plist_value "$FIREBASE" BUNDLE_ID)" != "ai.dividimos.app" ]; then
  fail "GoogleService-Info.plist belongs to '$(plist_value "$FIREBASE" BUNDLE_ID)', not ai.dividimos.app."
fi

[ -f "$APP/PrivacyInfo.xcprivacy" ] || fail "PrivacyInfo.xcprivacy is missing from the app bundle."

codesign --verify --deep --strict "$APP" || fail "codesign verification failed."

ENTITLEMENTS="$WORK/entitlements.plist"
codesign -d --entitlements - --xml "$APP" > "$ENTITLEMENTS" 2>/dev/null \
  || fail "could not read the signed entitlements."
[ "$(plist_value "$ENTITLEMENTS" application-identifier)" = "$APP_ID_PREFIX.ai.dividimos.app" ] \
  || fail "application-identifier is '$(plist_value "$ENTITLEMENTS" application-identifier)', expected $APP_ID_PREFIX.ai.dividimos.app; the AASA file serves APPLE_APP_ID_PREFIX."
[ "$(plist_value "$ENTITLEMENTS" aps-environment)" = "production" ] \
  || fail "aps-environment is '$(plist_value "$ENTITLEMENTS" aps-environment)', expected production."
[ "$(plist_value "$ENTITLEMENTS" get-task-allow)" != "true" ] \
  || fail "get-task-allow is true; this is a development signature."
[ "$(plist_entry "$ENTITLEMENTS" com.apple.developer.applesignin:0)" = "Default" ] \
  || fail "Sign in with Apple entitlement is missing."
[ "$(plist_entry "$ENTITLEMENTS" com.apple.developer.associated-domains:0)" = "applinks:www.dividimos.ai" ] \
  || fail "associated domains entitlement is not applinks:www.dividimos.ai."

PROFILE="$WORK/embedded.plist"
if security cms -D -i "$APP/embedded.mobileprovision" > "$PROFILE" 2>/dev/null; then
  if plutil -extract ProvisionedDevices xml1 -o - "$PROFILE" >/dev/null 2>&1 \
    || plutil -extract ProvisionsAllDevices xml1 -o - "$PROFILE" >/dev/null 2>&1; then
    fail "the embedded profile lists devices or provisions all of them; it is not an App Store profile."
  fi
  [ "$(plist_value "$PROFILE" TeamIdentifier.0)" = "$TEAM_ID" ] \
    || fail "the embedded profile belongs to team '$(plist_value "$PROFILE" TeamIdentifier.0)', expected $TEAM_ID."
  expiry="$(plist_value "$PROFILE" ExpirationDate)"
  expires_at="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$expiry" +%s 2>/dev/null || true)"
  if [ -z "$expires_at" ] || [ "$expires_at" -le "$(date -u +%s)" ]; then
    fail "the embedded profile is expired or has an unreadable expiry ($expiry)."
  fi
else
  fail "embedded.mobileprovision is missing or unreadable."
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures release problem(s) in $IPA." >&2
  exit 1
fi
echo "Release IPA OK: $IPA ($EXPECTED_MARKETING build $EXPECTED_BUILD)"
