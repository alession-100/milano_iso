#!/usr/bin/env bash
# T-6.5: are the level-0 (base) tile files of a tileset byte-identical to a reference copy?
#   bash scripts/compare-level0.sh <reference tiles dir> <tiles dir> [label]
# Level-0 files are `<i>_<j>.glb` and `<i>_<j>.json` (no `L<n>_` prefix). Compares sha256 lists; exit 0 when equal.
set -euo pipefail
ref="$1"
dir="$2"
label="${3:-level 0}"
list() {
  (cd "$1" && ls | grep -E '^-?[0-9]+_-?[0-9]+\.(glb|json)$' | LC_ALL=C sort | xargs -d '\n' sha256sum --)
}
a="$(mktemp)"
b="$(mktemp)"
list "$ref" > "$a"
list "$dir" > "$b"
echo "$label: $(wc -l < "$a") files in the reference, $(wc -l < "$b") files in the copy"
if diff "$a" "$b" > /dev/null; then
  echo "$label: byte-identical (sha256 of every file equal, diff exit 0)"
  rm -f "$a" "$b"
else
  echo "$label: DIFFERENT"
  diff "$a" "$b" | head -20
  rm -f "$a" "$b"
  exit 1
fi
