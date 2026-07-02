#!/usr/bin/env bash
#
# setup.sh — install all dependencies for the osascript-deobfuscator monorepo.
#
# Usage:  ./scripts/setup.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found on PATH. Install Node.js 20+ first." >&2
  exit 1
fi

echo "node: $(node -v)   npm: $(npm -v)"
echo "Installing workspace dependencies..."
npm install

echo
echo "Done. Now run:  ./scripts/test.sh"
