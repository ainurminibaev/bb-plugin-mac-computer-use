#!/usr/bin/env bash
# Local pre-release gate: run before tagging vX.Y.Z. Changes nothing remote.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(node -p "require('./package.json').version")
grep -q "^## \[$v\]" CHANGELOG.md || { echo "CHANGELOG.md has no section for $v"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Uncommitted changes"; exit 1; }
git rev-parse "v$v" >/dev/null 2>&1 && { echo "Tag v$v already exists"; exit 1; }
npm ci && npm run typecheck && npm test && bb plugin build .
echo "Ready: git tag -a v$v -m 'Release v$v' && git push origin HEAD v$v"
