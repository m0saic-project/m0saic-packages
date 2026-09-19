#!/usr/bin/env bash
#
# Refresh packages/platform/src/toolchain/ffmpeg/release-dates.json from
# upstream ffmpeg git tags. Run this when a new ffmpeg release ships and
# the comparator's tagged-release lookup needs to know about it.
#
# Usage (from repo root):
#   bash packages/platform/scripts/refresh-ffmpeg-release-dates.sh
#
# What it does:
#   1. Shallow-bare clones github.com/FFmpeg/FFmpeg into a tmp dir.
#   2. Reads every `refs/tags/n*` tagger date.
#   3. Filters out -rc and -dev tags (not shipped to users).
#   4. Writes a sorted-by-date JSON to release-dates.json.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out_file="${script_dir}/../src/toolchain/ffmpeg/release-dates.json"
tmp_dir="$(mktemp -d -t m0saic-ffmpeg-tags.XXXXXX)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "refresh-ffmpeg-release-dates: cloning FFmpeg tags into ${tmp_dir}"
git clone --bare --filter=blob:none --no-checkout \
  https://github.com/FFmpeg/FFmpeg.git "${tmp_dir}/repo" >/dev/null

today="$(date -u +%Y-%m-%d)"

# Pull (tag, taggerdate) pairs. The output is one per line: "n8.0.1|2025-11-20".
# We then drop -rc and -dev tags and strip the leading 'n' prefix.
cd "${tmp_dir}/repo"
git for-each-ref --sort=-taggerdate \
  --format='%(refname:short)|%(taggerdate:short)' 'refs/tags/n*' |
  grep -v -- '-rc\|-dev' |
  python3 -c "
import sys, json
m = {}
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    ref, date = line.split('|', 1)
    version = ref[1:] if ref.startswith('n') else ref
    if date and date[0].isdigit():
        m[version] = date
print(json.dumps({
    '_generatedAt': '${today}',
    '_source': 'github.com/FFmpeg/FFmpeg refs/tags/n*',
    'releases': m,
}, indent=2, sort_keys=False))
" > "${out_file}"

count="$(python3 -c "import json; print(len(json.load(open('${out_file}'))['releases']))")"
echo "refresh-ffmpeg-release-dates: wrote ${count} releases to ${out_file}"
