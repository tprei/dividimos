#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/cap-dev.sh [android|ios] [--emulator|--device] [--run]

  --emulator  Android emulator; the host dev server is reachable at 10.0.2.2.
  --device    Physical device. Set LAN_IP=<your machine's IP> to load over
              Wi-Fi, otherwise the script forwards port 3000 over USB with
              `adb reverse` and the WebView uses 127.0.0.1.
  --run       Build and launch with `cap run` instead of opening the IDE.

Examples:
  npm run cap:dev:android
  LAN_IP=192.168.0.14 scripts/cap-dev.sh android --device --run
  scripts/cap-dev.sh android --device --run
USAGE
}

PLATFORM=""
TARGET="emulator"
ACTION="open"

while [ $# -gt 0 ]; do
  case "$1" in
    android|ios) PLATFORM="$1"; shift ;;
    --emulator)  TARGET="emulator"; shift ;;
    --device)    TARGET="device"; shift ;;
    --run)       ACTION="run"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

PLATFORM="${PLATFORM:-android}"

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

LAN_IP="${LAN_IP:-localhost}"

echo "Platform: $PLATFORM ($TARGET)"
echo "Dev server URL for the WebView: http://$LAN_IP:3000"
echo "Make sure 'npm run dev' is running in another terminal."
echo ""

# The Capacitor config points at a server URL in dev, but the CLI still
# requires webDir to exist before it will sync.
mkdir -p out
if [ ! -f out/index.html ]; then
  cat > out/index.html <<'HTML'
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Dividimos</title></head>
<body><p>Carregando...</p></body>
</html>
HTML
fi

export CAPACITOR_DEV=true
export LAN_IP

npx cap sync "$PLATFORM"

if [ "$ACTION" = "run" ]; then
  npx cap run "$PLATFORM"
else
  npx cap open "$PLATFORM"
fi
