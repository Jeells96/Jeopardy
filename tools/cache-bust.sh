#!/usr/bin/env bash
# Run by the deploy, just before upload (see .github/workflows/deploy.yml): adds ?v=<version>
# to every module and stylesheet URL, so a phone never mixes cached old files with new ones.
# (Open screens notice a new deploy by themselves — see checkForUpdate in js/app.js.)
set -euo pipefail
V="${1:?usage: tools/cache-bust.sh <version>}"
cd "$(dirname "$0")/.."
find js -name '*.js' -print0 | xargs -0 sed -i -E "s#((from|import)[[:space:]]*\(?[[:space:]]*[\"'])(\.{1,2}/[^\"'?]+\.js)([\"'])#\1\3?v=$V\4#g"
sed -i -E "s#src=\"\./js/app\.js\"#src=\"./js/app.js?v=$V\"#; s#href=\"\./css/styles\.css\"#href=\"./css/styles.css?v=$V\"#" index.html
grep -q "js/app.js?v=$V" index.html
grep -q "css/styles.css?v=$V" index.html
# Every relative import must now carry the version (two URLs for one file = two copies).
if grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*[\"']\.{1,2}/[^\"'?]+\.js[\"']" js; then
  echo "unversioned import left over" >&2; exit 1
fi
echo "cache-busted with v=$V"
