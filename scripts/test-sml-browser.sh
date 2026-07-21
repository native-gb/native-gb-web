#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
origin="${NATIVE_GB_WEB_ORIGIN:-http://127.0.0.1:8791}"
rom="${SML_TEST_ROM:-$repo_root/../native-gb-super-mario-land-modern/roms/Super Mario Land (World) (Rev A).gb}"

if [[ ! -f "$repo_root/site/runtime/sml/manifest.json" ]]; then
    printf 'SML Modern browser bundle missing; run ./scripts/build-sml.sh first.\n' >&2
    exit 1
fi
if [[ ! -f "$rom" ]]; then
    printf 'SML Modern test ROM missing: %s\n' "$rom" >&2
    exit 1
fi
if [[ ! -d "$repo_root/node_modules/playwright-core" ]]; then
    printf 'Browser test dependency missing; run npm ci.\n' >&2
    exit 1
fi

mkdir -p "$repo_root/artifacts"
python3 -m http.server 8791 --bind 127.0.0.1 --directory "$repo_root/site" \
    >"$repo_root/artifacts/sml-browser-server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
    if curl --silent --fail "$origin/play/sml/" >/dev/null; then
        break
    fi
    sleep 0.1
done
curl --silent --fail "$origin/play/sml/" >/dev/null

NATIVE_GB_WEB_ORIGIN="$origin" SML_TEST_ROM="$rom" npm run test:browser:sml
