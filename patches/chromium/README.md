# Glint Chromium patches

The native half of Glint lives in a Chromium fork that is too large to host
on GitHub. These patches recreate it from a clean Chromium checkout.

## Rebuilding the fork

```bash
# 1. Get Chromium (see https://www.chromium.org/developers/how-tos/get-the-code/)
fetch chromium && cd src

# 2. Check out the exact base revision these patches apply to
git checkout $(head -1 patches/chromium/BASE_COMMIT.txt)
gclient sync

# 3. Apply the Glint patches in order
git am /path/to/desktop/patches/chromium/*.patch

# 4. Build (dev): args in the repo's build docs; component build recommended
gn gen out/glint && autoninja -C out/glint chrome
```

`BASE_COMMIT.txt` holds the upstream commit hash the series is based on.
Regenerate the series after new fork commits with:

```bash
scripts/export-patches.sh
```
