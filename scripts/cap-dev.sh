#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${1:-android}"

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo "LAN IP: $LAN_IP"
echo "Make sure 'npm run dev' is running in another terminal."
echo ""

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

echo ""
echo "WebView will load from http://$LAN_IP:3000"
echo "Opening $PLATFORM project..."

npx cap open "$PLATFORM"
