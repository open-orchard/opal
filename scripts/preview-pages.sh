#!/usr/bin/env bash
#
# Usage:  ./scripts/preview-pages.sh [repo-name]   (default: opal)
#
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-opal}"
export VITE_BASE="/${REPO}/"

echo "Building with base ${VITE_BASE} …"
npm run build:web

echo
echo "Open:  http://localhost:4173${VITE_BASE}"
echo "(Ctrl-C to stop)"
npm run preview --workspace=packages/web
