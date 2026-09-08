#!/bin/bash
# Updates the bundled models.dev/api.json used as a fallback model registry.
# Run this periodically to keep the bundled data fresh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DEST="$SCRIPT_DIR/../src/ios/Resources/models-dev-api.json"
ANDROID_DEST="$SCRIPT_DIR/../src/android/app/src/main/assets/models-dev-api.json"
URL="https://models.dev/api.json"

echo "Downloading $URL ..."
curl -fsSL "$URL" -o "$IOS_DEST.tmp"

# Validate JSON
if ! python3 -m json.tool "$IOS_DEST.tmp" > /dev/null 2>&1; then
    echo "ERROR: Downloaded file is not valid JSON"
    rm -f "$IOS_DEST.tmp"
    exit 1
fi

PROVIDERS=$(python3 -c "import json; d=json.load(open('$IOS_DEST.tmp')); print(len(d))")
echo "Valid JSON — $PROVIDERS providers"

mv "$IOS_DEST.tmp" "$IOS_DEST"
echo "Updated $IOS_DEST"

# The app resolves cross-provider model ids through a precomputed stage-2 index
# (ModelsDevAPI.buildStage2Index). Verify the new catalog still resolves exactly
# as a full per-key scan would, so a catalog update can never silently change
# which entry wins the majority vote.
echo "Verifying stage-2 resolution against the new catalog ..."
python3 "$SCRIPT_DIR/verify_models_dev_resolution.py"

# Copy to Android assets
cp "$IOS_DEST" "$ANDROID_DEST"
echo "Updated $ANDROID_DEST"

# Show size
SIZE=$(wc -c < "$IOS_DEST" | tr -d ' ')
echo "File size: ${SIZE} bytes"
