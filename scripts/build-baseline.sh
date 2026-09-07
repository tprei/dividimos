#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C
OUT=supabase/migrations/20260906000000_ledger_baseline.sql
cat > "$OUT" <<'HEADER'
-- Ledger baseline. This file is the concatenation of supabase/schemas/*.sql in
-- lexical order and is regenerated whenever a schema file changes:
--
--   ./scripts/build-baseline.sh
--
-- The declarative files under supabase/schemas/ are the source of truth.
HEADER
for f in supabase/schemas/*.sql; do
  printf '\n-- ---- %s ----\n' "$(basename "$f")" >> "$OUT"
  cat "$f" >> "$OUT"
done
echo "wrote $OUT ($(wc -l < "$OUT") lines)"
