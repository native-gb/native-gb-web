#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="$repo_root/.cache/emsdk"
build_root="$repo_root/build-wasm-tetris"

# shellcheck disable=SC1091
source "$repo_root/runtime/tetris/source-version.sh"

# Values are assigned by the pinned version file above.
# shellcheck disable=SC2154
if [[ -n "${TETRIS_SOURCE_DIR:-}" ]]; then
    tetris_root="$TETRIS_SOURCE_DIR"
else
    tetris_root="$repo_root/.cache/tetris-modern-$tetris_source_commit"
    if [[ ! -d "$tetris_root/.git" ]]; then
        git clone --filter=blob:none --no-checkout "$tetris_source_url" "$tetris_root"
        git -C "$tetris_root" fetch --depth 1 origin "$tetris_source_commit"
        git -C "$tetris_root" switch --detach "$tetris_source_commit"
    fi
    if [[ "$(git -C "$tetris_root" rev-parse HEAD)" != "$tetris_source_commit" ]]; then
        printf 'Cached Tetris source is not at the pinned commit: %s\n' "$tetris_root" >&2
        exit 1
    fi
fi

if [[ ! -f "$sdk_root/emsdk_env.sh" ]]; then
    "$repo_root/scripts/bootstrap-emsdk.sh"
fi
if [[ ! -f "$tetris_root/CMakeLists.txt" ]]; then
    printf 'Tetris source not found: %s\n' "$tetris_root" >&2
    exit 1
fi

# shellcheck disable=SC1091
source "$sdk_root/emsdk_env.sh" >/dev/null
emcmake cmake -S "$repo_root/runtime/tetris" -B "$build_root" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DTETRIS_SOURCE_DIR="$tetris_root"
cmake --build "$build_root" --target native-gb-tetris-browser

output_root="$repo_root/site/runtime/tetris"
cmake -E remove_directory "$output_root"
mkdir -p "$output_root"

wasm_hash="$(sha256sum "$build_root/native-gb-tetris.wasm" | cut -c1-16)"
wasm_name="native-gb-tetris.$wasm_hash.wasm"
cp "$build_root/native-gb-tetris.wasm" "$output_root/$wasm_name"

temporary_js="$output_root/native-gb-tetris.js"
sed "s/native-gb-tetris\\.wasm/$wasm_name/g" \
    "$build_root/native-gb-tetris.js" > "$temporary_js"
js_hash="$(sha256sum "$temporary_js" | cut -c1-16)"
js_name="native-gb-tetris.$js_hash.js"
mv "$temporary_js" "$output_root/$js_name"

source_commit="$(git -C "$tetris_root" rev-parse HEAD)"
printf '{\n  "schema": 1,\n  "source_commit": "%s",\n  "module": "%s",\n  "wasm": "%s"\n}\n' \
    "$source_commit" "$js_name" "$wasm_name" > "$output_root/manifest.json"
printf 'Built %s and %s\n' "$js_name" "$wasm_name"
