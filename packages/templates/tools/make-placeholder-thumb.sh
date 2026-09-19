#!/usr/bin/env bash
#
# make-placeholder-thumb.sh — bake a branded "M" placeholder thumbnail.
#
# A reusable gallery preview for templates whose real output doesn't communicate
# anything on its own — invisible (forensic watermark), non-visual data fetchers,
# directory/sequence output (frame stripper), or input-only utilities. Renders
# the m0saic mark on a dark card with a per-category motif and a per-template
# LABEL. Fully deterministic (ImageMagick).
#
# CONVENTION (motifs):
#   dissolve (default) — symmetric tile dissolve. Generic "no obvious cover art"
#                        templates. 16:9 (1920x1080).
#   data               — ordered cell-matrix backdrop ("normalized data sheet").
#                        Data / fetcher templates. Respects --square.
#
# The LABEL should name what makes THIS template unique (not its category), so
# siblings using the same style don't collide.
#
# USAGE (run from packages/templates so the asset path resolves):
#   tools/make-placeholder-thumb.sh "<LABEL>" <out.png> [--motif dissolve|data] [--square] [--icon <svg>]
#
# EXAMPLES:
#   # generic dissolve, 16:9:
#   tools/make-placeholder-thumb.sh "FRAME STRIPPER" assets/templates/.../preview.png
#
#   # data motif, 1:1, with a GitHub source badge (unmodified mark you already ship):
#   tools/make-placeholder-thumb.sh "GITHUB REPO FACTS" assets/templates/.../preview.png \
#     --motif data --square --icon ../../apps/mosaic/web/src/assets/... (the octocat svg)
#
#   npm run build          # regenerate template-manifest.json to wire the preview
#
# FLAGS:
#   --motif <dissolve|data>  category motif (default dissolve).
#   --square                 1080x1080 (1:1). Applies to the `data` motif;
#                            `dissolve` is always 16:9.
#   --icon <path.svg>        place an UNMODIFIED source mark (e.g. the GitHub
#                            Octocat) as a top-right corner badge, in ITS OWN
#                            color. Nominative use — do NOT recolor it to brand,
#                            keep it secondary to the M. Prefer marks already
#                            shipped in the product.
#
# NOTES: requires ImageMagick 7 (`magick`) + the Consolas font (FONT= to override).
#        The template must be registered in src/template-registry.ts for the
#        manifest to pick the asset up.
#
set -euo pipefail

# ── args ──
MOTIF="dissolve"; SQUARE=0; ICON=""
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --motif) MOTIF="$2"; shift 2 ;;
    --motif=*) MOTIF="${1#*=}"; shift ;;
    --square) SQUARE=1; shift ;;
    --icon) ICON="$2"; shift 2 ;;
    --icon=*) ICON="${1#*=}"; shift ;;
    *) POS+=("$1"); shift ;;
  esac
done
LABEL="${POS[0]:?usage: make-placeholder-thumb.sh \"<LABEL>\" <out.png> [--motif dissolve|data] [--square] [--icon <svg>]}"
OUT="${POS[1]:?usage: make-placeholder-thumb.sh \"<LABEL>\" <out.png> [--motif dissolve|data] [--square] [--icon <svg>]}"
FONT="${FONT:-Consolas}"

case "$MOTIF" in dissolve|data) ;; *) echo "error: --motif must be dissolve|data" >&2; exit 1 ;; esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SVG="$REPO_ROOT/apps/mosaic/assets/brand/mosaic-m.svg"

command -v magick >/dev/null 2>&1 || { echo "error: ImageMagick 'magick' not on PATH" >&2; exit 1; }
[ -f "$SVG" ] || { echo "error: brand M svg not found: $SVG" >&2; exit 1; }
[ -n "$ICON" ] && [ ! -f "$ICON" ] && { echo "error: --icon file not found: $ICON" >&2; exit 1; }

# ── canvas dims (dissolve tiles are hand-placed for 16:9; data tiles any size) ──
if [ "$MOTIF" = "dissolve" ] && [ "$SQUARE" = "1" ]; then
  echo "note: --square ignored for the dissolve motif (16:9 only)" >&2
fi
if [ "$MOTIF" = "data" ] && [ "$SQUARE" = "1" ]; then W=1080; H=1080; MH=430; MOFF=8; LOFF=92
else                                                   W=1920; H=1080; MH=560; MOFF=0; LOFF=72
fi

# ── auto-size the label so long names stay balanced/legible at card scale ──
LEN=${#LABEL}
if   [ "$LEN" -le 10 ]; then PT=62; KERN=14
elif [ "$LEN" -le 16 ]; then PT=54; KERN=10
else                        PT=46; KERN=8
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── shared: M mark + warm glow ──
magick -background none "$SVG" -resize x${MH} "$TMP/m.png"
magick -size 1200x1200 radial-gradient:'#3a1e0d'-black "$TMP/glow.png"

# ── motif backdrop (behind the M) ──
BACKDROP=()
if [ "$MOTIF" = "data" ]; then
  # ordered cell-matrix — a small rounded cell tiled across the canvas, faint.
  magick -size 72x72 xc:none -fill '#EF7525' -draw "roundrectangle 27,27 45,45 4,4" "$TMP/cell.png"
  # The `tile:` coder prefix stops Git-Bash/MSYS from rewriting the /tmp path to
  # Windows form, so convert it explicitly there (no-op on real POSIX).
  cell_path="$TMP/cell.png"
  command -v cygpath >/dev/null 2>&1 && cell_path="$(cygpath -w "$cell_path")"
  magick -size ${W}x${H} tile:"$cell_path" "$TMP/grid.png"
  BACKDROP=( "(" "$TMP/grid.png" -alpha set -channel A -evaluate multiply 0.10 +channel ")" -gravity center -compose over -composite )
fi

# base = dark + backdrop + glow + M
magick -size ${W}x${H} xc:'#0d1117' \
  "${BACKDROP[@]}" \
  "(" "$TMP/glow.png" -resize $((W*73/100))x$((W*73/100)) ")" -gravity center -compose screen -composite \
  "(" "$TMP/m.png" ")" -gravity center -geometry +0+${MOFF} -compose over -composite \
  "$TMP/base.png"

# ── dissolve tiles (only for the dissolve motif; hand-placed for 16:9) ──
TILES=()
if [ "$MOTIF" = "dissolve" ]; then
  TILES=(
    -fill '#EF7525'               -draw "roundrectangle 1258,470 1315,527 7,7"
    -fill '#EF7525'               -draw "roundrectangle 1334,424 1382,472 6,6"
    -fill 'rgba(239,117,37,0.88)' -draw "roundrectangle 1342,548 1384,590 6,6"
    -fill 'rgba(239,117,37,0.82)' -draw "roundrectangle 1410,492 1450,532 5,5"
    -fill 'rgba(239,117,37,0.70)' -draw "roundrectangle 1430,592 1462,624 4,4"
    -fill 'rgba(239,117,37,0.64)' -draw "roundrectangle 1488,448 1520,480 4,4"
    -fill 'rgba(239,117,37,0.56)' -draw "roundrectangle 1504,542 1532,570 4,4"
    -fill 'rgba(239,117,37,0.46)' -draw "roundrectangle 1566,500 1592,526 3,3"
    -fill 'rgba(239,117,37,0.40)' -draw "roundrectangle 1584,590 1606,612 3,3"
    -fill 'rgba(239,117,37,0.32)' -draw "roundrectangle 1628,462 1648,482 3,3"
    -fill 'rgba(239,117,37,0.27)' -draw "roundrectangle 1648,548 1666,566 3,3"
    -fill 'rgba(239,117,37,0.22)' -draw "roundrectangle 1700,508 1716,524 2,2"
    -fill 'rgba(239,117,37,0.16)' -draw "roundrectangle 1730,470 1744,484 2,2"
    -fill 'rgba(239,117,37,0.13)' -draw "roundrectangle 1760,540 1772,552 2,2"
    -fill '#EF7525'               -draw "roundrectangle 605,470 662,527 7,7"
    -fill '#EF7525'               -draw "roundrectangle 538,424 586,472 6,6"
    -fill 'rgba(239,117,37,0.88)' -draw "roundrectangle 536,548 578,590 6,6"
    -fill 'rgba(239,117,37,0.82)' -draw "roundrectangle 470,492 510,532 5,5"
    -fill 'rgba(239,117,37,0.70)' -draw "roundrectangle 458,592 490,624 4,4"
    -fill 'rgba(239,117,37,0.64)' -draw "roundrectangle 400,448 432,480 4,4"
    -fill 'rgba(239,117,37,0.56)' -draw "roundrectangle 388,542 416,570 4,4"
    -fill 'rgba(239,117,37,0.46)' -draw "roundrectangle 328,500 354,526 3,3"
    -fill 'rgba(239,117,37,0.40)' -draw "roundrectangle 314,590 336,612 3,3"
    -fill 'rgba(239,117,37,0.32)' -draw "roundrectangle 272,462 292,482 3,3"
    -fill 'rgba(239,117,37,0.27)' -draw "roundrectangle 254,548 272,566 3,3"
    -fill 'rgba(239,117,37,0.22)' -draw "roundrectangle 204,508 220,524 2,2"
    -fill 'rgba(239,117,37,0.16)' -draw "roundrectangle 176,470 190,484 2,2"
    -fill 'rgba(239,117,37,0.13)' -draw "roundrectangle 148,540 160,552 2,2"
  )
fi

# ── optional source badge (top-right corner), unmodified, in its own color ──
BADGE=()
if [ -n "$ICON" ]; then
  magick -background none "$ICON" -resize x$((H*12/100)) "$TMP/icon.png"
  BADGE=( "(" "$TMP/icon.png" ")" -gravity northeast -geometry +54+54 -compose over -composite )
fi

# ── compose tiles + badge + label ──
magick "$TMP/base.png" \
  "${TILES[@]}" \
  "${BADGE[@]}" \
  -gravity south -font "$FONT" -pointsize "$PT" -kerning "$KERN" -fill '#aeb8c6' \
    -annotate +0+${LOFF} "$LABEL" \
  "$OUT"

echo "wrote $OUT  (motif=$MOTIF, ${W}x${H}, label \"$LABEL\" ${PT}pt${ICON:+, icon $(basename "$ICON")})"
