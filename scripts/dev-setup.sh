#!/usr/bin/env bash
# One-command local development setup for Pixwise.
# Detects Docker → runs local Supabase. No Docker → uses remote project.
#
# Usage:
#   ./scripts/dev-setup.sh                  # auto-detect mode
#   ./scripts/dev-setup.sh --local          # force local Supabase (needs Docker)
#   ./scripts/dev-setup.sh --remote         # force remote (reads SUPABASE_PROJECT_REF)

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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)  MODE="local";  shift ;;
    --remote) MODE="remote"; shift ;;
    *)        error "Unknown flag: $1"; exit 1 ;;
  esac
done

# -------------------------------------------------------------------
# Ensure npm dependencies are installed
# -------------------------------------------------------------------
if [ ! -d node_modules ]; then
  info "Installing npm dependencies..."
  npm install
fi

# -------------------------------------------------------------------
# Ensure supabase CLI is available
# -------------------------------------------------------------------
if ! command -v supabase &>/dev/null; then
  if command -v npx &>/dev/null; then
    info "supabase CLI not found — will use npx supabase"
    supabase() { npx supabase "$@"; }
  else
    error "supabase CLI not found. Install with: npm i -g supabase"
    exit 1
  fi
fi

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

  PIX_KEY=$(openssl rand -hex 32)

  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
PIX_ENCRYPTION_KEY=${PIX_KEY}
NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=true
EOF

  info "Local Supabase is running. .env.local written."
  info "Seed users: alice / bob / carol @test.pixwise.local (password123)"
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
NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=true
EOF

    warn "Only / and /demo will work. Auth and app pages require real credentials."
    exit 0
  fi

  PIX_KEY=$(openssl rand -hex 32)

  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${SB_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SB_ANON}
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE}
PIX_ENCRYPTION_KEY=${PIX_KEY}
NEXT_PUBLIC_AUTH_PHONE_TEST_MODE=true
EOF

  info "Remote Supabase credentials written to .env.local"
  info "Run 'npm run dev' to start the app."
fi
