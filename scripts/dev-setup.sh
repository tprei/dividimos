#!/usr/bin/env bash
# One-command local development setup for Dividimos.
# Detects Docker → runs local Supabase. No Docker → uses remote project.
#
# Usage:
#   ./scripts/dev-setup.sh                  # auto-detect mode
#   ./scripts/dev-setup.sh --local          # force local Supabase (needs Docker)
#   ./scripts/dev-setup.sh --remote         # force remote (reads SUPABASE_PROJECT_REF)
#   ./scripts/dev-setup.sh --reset-encryption-key   # mint a new PIX_ENCRYPTION_KEY,
#                                                   # abandoning existing ciphertext

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[info]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

# -------------------------------------------------------------------
# Parse flags
# -------------------------------------------------------------------
MODE="auto"
RESET_ENCRYPTION_KEY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)  MODE="local";  shift ;;
    --remote) MODE="remote"; shift ;;
    --reset-encryption-key) RESET_ENCRYPTION_KEY=true; shift ;;
    *)        error "Unknown flag: $1"; exit 1 ;;
  esac
done

# -------------------------------------------------------------------
# Pix encryption key
#
# AES-GCM ciphertext already in the database (Pix keys, encrypted push
# payloads) can only be read with the key that wrote it. Minting a new one on
# every run silently destroyed that data, so an existing key is reused and a
# missing one is a hard stop unless the operator asks for a reset.
# -------------------------------------------------------------------
read_existing_pix_key() {
  [ -f .env.local ] || return 1
  local key
  key=$(grep -m1 '^PIX_ENCRYPTION_KEY=' .env.local | cut -d= -f2- | tr -d '\r\n "')
  [[ "$key" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  printf '%s' "$key"
}

resolve_pix_key() {
  if $RESET_ENCRYPTION_KEY; then
    warn "--reset-encryption-key: minting a new key. Existing Pix keys and"
    warn "encrypted push payloads in this database become unreadable."
    openssl rand -hex 32
    return 0
  fi

  local existing
  if existing=$(read_existing_pix_key); then
    printf '%s' "$existing"
    return 0
  fi

  if [ -f .env.local ]; then
    error "No usable PIX_ENCRYPTION_KEY in .env.local (a 64-hex value is required)."
    error "Refusing to mint a new one: ciphertext written with the old key would"
    error "become unreadable. Restore the key, or run with --reset-encryption-key"
    error "to start over and accept the loss."
    exit 1
  fi

  openssl rand -hex 32
}

# -------------------------------------------------------------------
# Ensure npm dependencies are installed
# -------------------------------------------------------------------
if [ ! -d node_modules ]; then
  info "Installing npm dependencies..."
  npm install
fi

# -------------------------------------------------------------------
# Supabase CLI: the pinned one from devDependencies, and nothing else.
# A different version writes different migrations and starts a different
# stack than CI, which is how local green turns into CI red.
# -------------------------------------------------------------------
SUPABASE_CLI_VERSION=$(node -p "require('./package.json').devDependencies.supabase")
SUPABASE_BIN="./node_modules/.bin/supabase"

if [ ! -x "$SUPABASE_BIN" ]; then
  error "Pinned Supabase CLI not installed at $SUPABASE_BIN."
  error "Run: npm install"
  exit 1
fi

supabase() { "$SUPABASE_BIN" "$@"; }

ACTUAL_CLI_VERSION=$("$SUPABASE_BIN" --version 2>/dev/null | tr -d 'v \r\n')
if [ "$ACTUAL_CLI_VERSION" != "$SUPABASE_CLI_VERSION" ]; then
  error "Supabase CLI version mismatch: expected $SUPABASE_CLI_VERSION, found ${ACTUAL_CLI_VERSION:-none}."
  error "Run: npm install"
  exit 1
fi
info "Supabase CLI $SUPABASE_CLI_VERSION (pinned, matches CI)."

# -------------------------------------------------------------------
# Detect mode
# -------------------------------------------------------------------
HAS_DOCKER=false
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  HAS_DOCKER=true
fi

if [ "$MODE" = "auto" ]; then
  if $HAS_DOCKER; then
    MODE="local"
  else
    MODE="remote"
  fi
fi

if [ "$MODE" = "local" ] && ! $HAS_DOCKER; then
  error "Docker is required for local Supabase but is not running."
  error "Either start Docker or use: ./scripts/dev-setup.sh --remote"
  exit 1
fi

# -------------------------------------------------------------------
# Local mode: supabase start
# -------------------------------------------------------------------
if [ "$MODE" = "local" ]; then
  info "Starting local Supabase (this may take a few minutes on first run)..."
  supabase start

  API_URL=$(supabase status --output json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('API_URL', d.get('api_url', '')))" 2>/dev/null || echo "http://localhost:54321")
  ANON_KEY=$(supabase status --output json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ANON_KEY', d.get('anon_key', '')))" 2>/dev/null || echo "")
  SERVICE_ROLE_KEY=$(supabase status --output json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('SERVICE_ROLE_KEY', d.get('service_role_key', '')))" 2>/dev/null || echo "")

  if [ -z "$ANON_KEY" ]; then
    error "Could not read keys from supabase status. Check supabase start output."
    exit 1
  fi

  PIX_KEY=$(resolve_pix_key)

  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
PIX_ENCRYPTION_KEY=${PIX_KEY}
DEV_LOGIN_ENABLED=true
EOF

  info "Local Supabase is running. .env.local written."
  info "Run 'npm run dev' to start the app."

# -------------------------------------------------------------------
# Remote mode: use existing project credentials
# -------------------------------------------------------------------
elif [ "$MODE" = "remote" ]; then
  info "Setting up with remote Supabase project..."

  # Check if .env.local already has real Supabase values
  if [ -f .env.local ] && grep -q "NEXT_PUBLIC_SUPABASE_URL=" .env.local; then
    EXISTING_URL=$(grep "NEXT_PUBLIC_SUPABASE_URL=" .env.local | cut -d= -f2-)
    if [ "$EXISTING_URL" != "https://placeholder.supabase.co" ] && [ -n "$EXISTING_URL" ]; then
      info ".env.local already has Supabase credentials. Skipping."
      info "Run 'npm run dev' to start the app."
      exit 0
    fi
  fi

  # Try environment variables first
  SB_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
  SB_ANON="${SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
  SB_SERVICE="${SUPABASE_SERVICE_ROLE_KEY:-}"

  if [ -z "$SB_URL" ] || [ -z "$SB_ANON" ]; then
    warn "No Supabase credentials found in environment."
    warn ""
    warn "Set these env vars and re-run, or create .env.local manually:"
    warn "  SUPABASE_URL=https://your-project.supabase.co"
    warn "  SUPABASE_ANON_KEY=your-anon-key"
    warn "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
    warn ""
    warn "Writing placeholder .env.local (public pages only)..."

    cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.placeholder
PIX_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
DEV_LOGIN_ENABLED=true
EOF

    warn "Only / and /demo will work. Auth and app pages require real credentials."
    exit 0
  fi

  PIX_KEY=$(resolve_pix_key)

  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${SB_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SB_ANON}
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE}
PIX_ENCRYPTION_KEY=${PIX_KEY}
DEV_LOGIN_ENABLED=true
EOF

  info "Remote Supabase credentials written to .env.local"
  info "Run 'npm run dev' to start the app."
fi
