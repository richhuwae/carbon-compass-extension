#!/bin/bash
# Carbon Compass — One-time SLM setup
# Downloads Transformers.js (IIFE build) so the SLM worker can load it locally.
# This is required because Manifest V3 blocks external CDN scripts via CSP.
#
# Run once from the extension directory:
#   bash setup.sh

set -e

DEST="transformers.min.js"
URL="https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"

echo "🌱 Carbon Compass — SLM Setup"
echo "Downloading Transformers.js v2.17.2 (IIFE build, ~2.4 MB)..."

if command -v curl &>/dev/null; then
  curl -L --progress-bar -o "$DEST" "$URL"
elif command -v wget &>/dev/null; then
  wget -q --show-progress -O "$DEST" "$URL"
else
  echo "❌ Neither curl nor wget found. Please download manually:"
  echo "   $URL"
  echo "   → Save as: transformers.min.js"
  exit 1
fi

SIZE=$(wc -c < "$DEST")
if [ "$SIZE" -lt 1000000 ]; then
  echo "❌ Download looks incomplete ($SIZE bytes). Please retry."
  rm -f "$DEST"
  exit 1
fi

echo ""
echo "✅ Done! transformers.min.js downloaded ($(du -h "$DEST" | cut -f1))"
echo ""
echo "Next steps:"
echo "  1. Go to chrome://extensions"
echo "  2. Click 'Reload' on Carbon Compass"
echo "  3. Open the popup — the SLM will load on first use"
echo "     (model weights ~150 MB are downloaded once from HuggingFace, then cached)"
echo ""
echo "📋 Model: Xenova/flan-t5-small · 80M params · Apache 2.0 · SDG 13 Climate Action"
