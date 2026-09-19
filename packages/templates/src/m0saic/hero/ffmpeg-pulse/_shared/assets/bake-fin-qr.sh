#!/usr/bin/env bash
# Re-bake the Fin premium QR (green QR Code + FFmpeg logo center, pixelate assemble)
# to a flat video the fin beat references as chromeAssets.qrFin. Run from repo root.
# (Originally baked via qr-carve/v1, deleted 2026-07-22 — QR Code's Center group
# + Output mp4 spawn are the same engine; square style renders radius-0 eyes.)
set -euo pipefail
AD="packages/templates/src/m0saic/hero/ffmpeg-pulse/_shared/assets"
LOGO="$(pwd)/$AD/ffmpeg-logo.png"
m0saic make "@m0saic/media/qr/code/v1" -o "$AD/qr-fin.mp4" --width 720 --height 720 --durationMs 6000 --no-alpha \
  --props "{\"text\":\"https://www.m0saic.io\",\"moduleColor\":\"#3fb950\",\"version\":8,\"mode\":\"dark\",\"moduleStyle\":\"square\",\"outputFormat\":\"mp4\",\"center\":{\"assetPath\":\"$LOGO\",\"width\":170,\"height\":170}}"
echo "baked → $AD/qr-fin.mp4"
