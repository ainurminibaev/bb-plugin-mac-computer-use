#!/usr/bin/env bash
# Mirror this repository into a bb-config checkout (plugins/mac-computer-use).
# Usage: scripts/sync-bb-config.sh /path/to/bb-config
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:?bb-config path}/plugins/mac-computer-use"
mkdir -p "$dst"
rsync -a --delete --exclude .git --exclude .github --exclude node_modules --exclude dist --exclude marketplace "$src/" "$dst/"
echo "Synced to $dst"
