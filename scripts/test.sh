#!/usr/bin/env bash
#
# test.sh — typecheck + run the full test suite for every workspace.
#
# Usage:  ./scripts/test.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "ERROR: dependencies not installed. Run ./scripts/setup.sh first." >&2
  exit 1
fi

echo "==> engine: typecheck"
npm run typecheck --workspace=packages/engine

echo "==> engine: tests"
npm run test --workspace=packages/engine

if [ -d packages/web ]; then
  echo "==> web: tests"
  npm run test --workspace=packages/web
else
  echo "==> web: package not present yet, skipping"
fi

echo
echo "All checks complete."
