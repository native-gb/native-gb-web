#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
origin="${NATIVE_GB_WEB_ORIGIN:-http://127.0.0.1:8790}"
rom="${TETRIS_TEST_ROM:-$repo_root/../native-gb-tetris-modern/roms/Tetris (JUE) (V1.1) [!].gb}"

if [[ ! -f "$repo_root/site/runtime/tetris/manifest.json" ]]; then
    printf 'Browser bundle missing; run ./scripts/build-tetris.sh first.\n' >&2
    exit 1
fi
if [[ ! -f "$rom" ]]; then
    printf 'Tetris test ROM missing: %s\n' "$rom" >&2
    exit 1
fi
if [[ ! -d "$repo_root/node_modules/playwright-core" ]]; then
    printf 'Browser test dependency missing; run npm ci.\n' >&2
    exit 1
fi

mkdir -p "$repo_root/artifacts"
python3 -m http.server 8790 --bind 127.0.0.1 --directory "$repo_root/site" \
    >"$repo_root/artifacts/browser-server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
    if curl --silent --fail "$origin/play/tetris/" >/dev/null; then
        break
    fi
    sleep 0.1
done
curl --silent --fail "$origin/play/tetris/" >/dev/null

NATIVE_GB_WEB_ORIGIN="$origin" TETRIS_TEST_ROM="$rom" npm run test:browser
