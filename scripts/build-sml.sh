#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="$repo_root/.cache/emsdk"
build_root="$repo_root/build-wasm-sml"

# shellcheck disable=SC1091
source "$repo_root/runtime/sml/source-version.sh"

if [[ -n "${SML_SOURCE_DIR:-}" ]]; then
    sml_root="$SML_SOURCE_DIR"
elif [[ -n "$sml_source_commit" ]]; then
    sml_root="$repo_root/.cache/sml-modern-$sml_source_commit"
    if [[ ! -d "$sml_root/.git" ]]; then
        git clone --filter=blob:none --no-checkout "$sml_source_url" "$sml_root"
        git -C "$sml_root" fetch --depth 1 origin "$sml_source_commit"
        git -C "$sml_root" switch --detach "$sml_source_commit"
    fi
    if [[ "$(git -C "$sml_root" rev-parse HEAD)" != "$sml_source_commit" ]]; then
        printf 'Cached SML Modern source is not at the pinned commit: %s\n' "$sml_root" >&2
        exit 1
    fi
else
    printf 'SML Modern has no source pin. Set SML_SOURCE_DIR for local development.\n' >&2
    exit 1
fi

if [[ ! -f "$sdk_root/emsdk_env.sh" ]]; then
    "$repo_root/scripts/bootstrap-emsdk.sh"
fi
if [[ ! -f "$sml_root/CMakeLists.txt" ]]; then
    printf 'SML Modern source not found: %s\n' "$sml_root" >&2
    exit 1
fi

# shellcheck disable=SC1091
source "$sdk_root/emsdk_env.sh" >/dev/null
emcmake cmake -S "$repo_root/runtime/sml" -B "$build_root" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DSML_SOURCE_DIR="$sml_root"
cmake --build "$build_root" --target native-gb-sml-browser

output_root="$repo_root/site/runtime/sml"
cmake -E remove_directory "$output_root"
mkdir -p "$output_root"

wasm_hash="$(sha256sum "$build_root/native-gb-sml.wasm" | cut -c1-16)"
wasm_name="native-gb-sml.$wasm_hash.wasm"
cp "$build_root/native-gb-sml.wasm" "$output_root/$wasm_name"

temporary_js="$output_root/native-gb-sml.js"
sed "s/native-gb-sml\\.wasm/$wasm_name/g" \
    "$build_root/native-gb-sml.js" > "$temporary_js"
js_hash="$(sha256sum "$temporary_js" | cut -c1-16)"
js_name="native-gb-sml.$js_hash.js"
mv "$temporary_js" "$output_root/$js_name"

source_commit="$(git -C "$sml_root" rev-parse HEAD)"
printf '{\n  "schema": 1,\n  "source_commit": "%s",\n  "module": "%s",\n  "wasm": "%s"\n}\n' \
    "$source_commit" "$js_name" "$wasm_name" > "$output_root/manifest.json"
printf 'Built %s and %s\n' "$js_name" "$wasm_name"
