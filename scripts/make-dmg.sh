#!/bin/bash
# Packages the Glint release build into a distributable .dmg.
# Run after: autoninja -C ~/chromium/src/out/glint-release chrome
set -euo pipefail

SRC="$HOME/chromium/src"
OUT="$SRC/out/glint-release"
APP="$OUT/Glint.app"

[ -d "$APP" ] || { echo "No app at $APP — build first."; exit 1; }

# 1) Bake the Glint component extensions into the bundle.
#    chrome::DIR_RESOURCES on macOS resolves inside the FRAMEWORK bundle
#    (Glint Framework.framework/Versions/<v>/Resources), not the app's
#    Contents/Resources.
FRAMEWORK=$(/bin/ls -d "$APP/Contents/Frameworks/"*.framework | head -1)
RES=$(/bin/ls -d "$FRAMEWORK/Versions/"*/Resources 2>/dev/null | head -1)
[ -d "$RES" ] || { echo "No framework Resources dir found"; exit 1; }
for c in glint_ui glint_ublock glint_schibsted; do
  [ -d "$SRC/chrome/browser/resources/$c" ] || { echo "missing $c"; exit 1; }
  rm -rf "$RES/$c"
  cp -R "$SRC/chrome/browser/resources/$c" "$RES/$c"
  echo "baked: $c"
done

# 2) Re-sign ad-hoc: baking resources broke the bundle seals. No hardened
#    runtime => no entitlement/library-validation concerns.
codesign --force --deep --sign - "$APP" 2>&1 | tail -1 || true

# 3) Wrap in a dmg with an Applications shortcut. Staged dir = volume root.
#    hdiutil create, not pkg-dmg: pkg-dmg's HFS-hybrid path pollutes files
#    with com.apple.FinderInfo xattrs, which strict Gatekeeper validation
#    rejects ("damaged") on quarantined downloads.
VER=$(defaults read "$APP/Contents/Info" CFBundleShortVersionString)
DMG="$HOME/Desktop/Glint-$VER-arm64.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
rsync -a "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Glint" -srcfolder "$STAGE" -ov -format UDBZ "$DMG"

echo
echo "Done: $DMG"
echo "Unsigned build — first-open instructions for recipients"
echo "(macOS 15+ removed the right-click->Open bypass):"
echo "  A) Double-click Glint.app, click Done, then System Settings ->"
echo "     Privacy & Security -> scroll down -> 'Open Anyway'"
echo "  B) or in Terminal: xattr -cr /Applications/Glint.app"
