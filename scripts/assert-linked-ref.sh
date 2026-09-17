#!/usr/bin/env bash
# Fails unless the linked Supabase project is the production ref.
# A human runs this before a linked push; nothing enforces it automatically.

set -euo pipefail
cd "$(dirname "$0")/.."

expected="sfclcrjeckixhpjfmrox"
file="supabase/.temp/project-ref"
if [ ! -f "$file" ]; then
  echo "assert-linked-ref: $file missing; run 'supabase link --project-ref $expected'" >&2
  exit 1
fi
actual="$(tr -d '[:space:]' < "$file")"
if [ "$actual" != "$expected" ]; then
  echo "assert-linked-ref: linked to '$actual', expected '$expected'" >&2
  exit 1
fi
echo "linked ref ok: $actual"
