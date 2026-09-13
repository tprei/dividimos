#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export LC_ALL=C
OUT=supabase/schema.sql
cat > "$OUT" <<'HEADER'
-- Schema snapshot. This file is the concatenation of supabase/schemas/*.sql in
-- lexical order and is regenerated whenever a schema file changes:
--
--   ./scripts/build-baseline.sh
--
-- It is a snapshot of the current declarative schemas, NOT an applied
-- migration: supabase/migrations/ holds the frozen applied baseline plus
-- forward migrations. The declarative files under supabase/schemas/ are the
-- source of truth.
HEADER
for f in supabase/schemas/*.sql; do
  printf '\n-- ---- %s ----\n' "$(basename "$f")" >> "$OUT"
  cat "$f" >> "$OUT"
done
echo "wrote $OUT ($(wc -l < "$OUT") lines)"
