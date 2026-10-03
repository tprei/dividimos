#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/cap-dev.sh [android|ios] [--emulator|--simulator|--device] [--run]

  --emulator   Android emulator; the host dev server is reachable at 10.0.2.2.
  --simulator  iOS Simulator (the iOS default); it shares the Mac's network,
               so the WebView loads http://localhost:3000.
  --device     Physical device. Android: set LAN_IP=<your machine's IP> to load
               over Wi-Fi, otherwise the script forwards port 3000 over USB with
               `adb reverse` and the WebView uses 127.0.0.1. iOS: set
               DEV_SERVER_URL=<https tunnel to port 3000>; an iPhone has no USB
               port forwarding, and http on a LAN IP is not a secure context, so
               LAN_IP only serves the signed-out pages.
  --run        Build and launch with `cap run` instead of opening the IDE.

Examples:
  npm run cap:dev:android
  LAN_IP=192.168.0.14 scripts/cap-dev.sh android --device --run
  scripts/cap-dev.sh android --device --run
  npm run cap:dev:ios
  DEV_SERVER_URL=https://<tunnel> scripts/cap-dev.sh ios --device --run
USAGE
}

PLATFORM=""
TARGET=""
ACTION="open"

while [ $# -gt 0 ]; do
  case "$1" in
    android|ios) PLATFORM="$1"; shift ;;
    --emulator)  TARGET="emulator"; shift ;;
    --simulator) TARGET="simulator"; shift ;;
    --device)    TARGET="device"; shift ;;
    --run)       ACTION="run"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

PLATFORM="${PLATFORM:-android}"

case "${DEV_SERVER_URL:-}" in
  ""|https://*) ;;
  *) echo "error: DEV_SERVER_URL must be an https:// URL; the app needs a secure origin." >&2; exit 1 ;;
esac

if [ "$PLATFORM" = "android" ]; then
  TARGET="${TARGET:-emulator}"
  if [ "$TARGET" = "simulator" ]; then
    echo "error: --simulator is iOS-only; use --emulator for Android." >&2
    exit 1
  fi
else
  TARGET="${TARGET:-simulator}"
  if [ "$TARGET" = "emulator" ]; then
    echo "error: --emulator is Android-only; use --simulator for iOS." >&2
    exit 1
  fi
fi

if [ "$PLATFORM" = "ios" ]; then
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "error: iOS builds require macOS with Xcode and CocoaPods installed." >&2
    echo "       This machine is $(uname -s). Use 'android', or run the PWA in Safari." >&2
    exit 1
  fi
  if [ ! -d ios ]; then
    echo "error: the native iOS project is not initialized in this repo." >&2
    echo "       There is no ios/ directory, so there is nothing to sync or open." >&2
    exit 1
  fi
  if [ "$TARGET" = "device" ]; then
    if [ -z "${LAN_IP:-}" ] && [ -z "${DEV_SERVER_URL:-}" ]; then
      echo "error: an iPhone cannot reach the Mac's localhost; set DEV_SERVER_URL=<https tunnel to port 3000>, or LAN_IP=<your Mac's Wi-Fi IP> for the signed-out pages only." >&2
      exit 1
    fi
  else
    LAN_IP="localhost"
    export CAPACITOR_IOS_SIMULATOR=true
  fi
fi

if [ "$PLATFORM" = "android" ]; then
  if ! command -v adb >/dev/null 2>&1; then
    echo "error: adb not found. Install the Android SDK platform-tools and put them on PATH." >&2
    exit 1
  fi

  if [ "$TARGET" = "device" ]; then
    if [ -z "${LAN_IP:-}" ]; then
      # Without a caller-supplied address the device cannot resolve the host,
      # so the dev server is forwarded over USB instead of guessing an IP.
      adb reverse tcp:3000 tcp:3000
      LAN_IP="127.0.0.1"
      echo "LAN_IP unset: forwarded tcp:3000 over adb; WebView will use 127.0.0.1."
    fi
  else
    LAN_IP="${LAN_IP:-10.0.2.2}"
  fi

  if ! adb devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'; then
    echo "error: no connected Android device or running emulator (adb devices)." >&2
    exit 1
  fi
fi

echo "Platform: $PLATFORM ($TARGET)"
if [ -n "${DEV_SERVER_URL:-}" ]; then
  echo "Dev server URL for the WebView: $DEV_SERVER_URL"
  echo "Make sure 'DEV_SERVER_URL=$DEV_SERVER_URL npm run dev' is running in another terminal behind that tunnel."
else
  echo "Dev server URL for the WebView: http://$LAN_IP:3000"
  case "$LAN_IP" in
    localhost|127.0.0.1|10.0.2.2) echo "Make sure 'npm run dev' is running in another terminal." ;;
    *) echo "Make sure 'LAN_IP=$LAN_IP npm run dev' is running in another terminal; Next only serves hot reload to hosts in allowedDevOrigins." ;;
  esac
fi
echo ""

export CAPACITOR_DEV=true
export LAN_IP

npx cap sync "$PLATFORM"

if [ "$ACTION" = "run" ]; then
  npx cap run "$PLATFORM"
else
  npx cap open "$PLATFORM"
fi
