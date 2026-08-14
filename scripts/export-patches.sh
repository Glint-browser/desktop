#!/bin/bash
# Exports the Glint commits from the local Chromium fork into patches/chromium
# so the native work is backed up in this repo. Run after every fork commit.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$HOME/chromium/src"
BASE=$(git -C "$SRC" merge-base HEAD origin/main)
rm -f patches/chromium/*.patch
git -C "$SRC" format-patch "$BASE"..HEAD -o "$PWD/patches/chromium" --no-signature >/dev/null
git -C "$SRC" log -1 --format=%H "$BASE" > patches/chromium/BASE_COMMIT.txt
echo "$(ls patches/chromium/*.patch | wc -l | tr -d ' ') patches exported (base $(cut -c1-12 patches/chromium/BASE_COMMIT.txt))"
