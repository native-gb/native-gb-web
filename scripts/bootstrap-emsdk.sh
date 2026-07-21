#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_root="$repo_root/.cache/emsdk"
version="6.0.3"
commit="db04e88298d9916fc51fcd3743045ca3eb695127"

if [[ ! -d "$sdk_root/.git" ]]; then
    mkdir -p "$(dirname "$sdk_root")"
    git clone --filter=blob:none https://github.com/emscripten-core/emsdk.git "$sdk_root"
fi

current="$(git -C "$sdk_root" rev-parse HEAD)"
if [[ "$current" != "$commit" ]]; then
    git -C "$sdk_root" fetch --depth 1 origin "refs/tags/$version"
    git -C "$sdk_root" checkout --detach "$commit"
fi

"$sdk_root/emsdk" install "$version"
"$sdk_root/emsdk" activate "$version"
printf '%s\n' "$sdk_root"
