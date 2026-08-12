#!/bin/bash
# Syncs the built extension into the Chromium fork as the baked-in component.
# The key is persisted in component-key.txt — NEVER regenerate it: a new key
# means a new extension id, which orphans users' chrome.storage on upgrade.
set -e
cd "$(dirname "$0")"
D=~/chromium/src/chrome/browser/resources/glint_ui
rm -rf "$D"
cp -R dist "$D"
python3 - << 'PY'
import json, os
p = os.path.expanduser('~/chromium/src/chrome/browser/resources/glint_ui/manifest.json')
m = json.load(open(p))
m['key'] = open('component-key.txt').read().strip()
json.dump(m, open(p, 'w'), indent=2)
PY
echo "component synced ($D)"
