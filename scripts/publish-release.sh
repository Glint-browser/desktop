#!/bin/bash
# Publishes a new Glint version: bumps the version, rebuilds the UI, bakes
# the dmg, and creates a GitHub Release that the in-app update check finds.
#
# Usage: scripts/publish-release.sh 1.0.1
#
# First-time setup:
#   brew install gh && gh auth login
#   gh repo create Glint-browser/glint --public
#
# If NATIVE (C++) code changed since the last release build, run first:
#   autoninja -C ~/chromium/src/out/glint-release chrome
set -euo pipefail
V=${1:?usage: publish-release.sh <version>}
REPO="Glint-browser/glint"
command -v gh >/dev/null || { echo "Needs GitHub CLI: brew install gh && gh auth login"; exit 1; }
cd "$(dirname "$0")/.."

python3 - "$V" << 'PY'
import json, sys
p = 'chromium-ui/public/manifest.json'
m = json.load(open(p))
m['version'] = sys.argv[1]
json.dump(m, open(p, 'w'), indent=2)
PY

( cd chromium-ui && npm run build && ./sync-component.sh )
./scripts/make-dmg.sh

SRC_DMG=$(/bin/ls -t "$HOME"/Desktop/Glint-*-arm64.dmg | head -1)
DMG="$HOME/Desktop/Glint-$V-arm64.dmg"
[ "$SRC_DMG" = "$DMG" ] || mv "$SRC_DMG" "$DMG"

gh release create "v$V" "$DMG" --repo "$REPO" --title "Glint $V" --generate-notes
git add chromium-ui/public/manifest.json
git commit -m "release: v$V"
echo
echo "Published: https://github.com/$REPO/releases/tag/v$V"
