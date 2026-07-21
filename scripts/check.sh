#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$repo_root"
./scripts/audit-distribution.py
python3 -m unittest discover -s tests -v
node --check site/catalog.js
node --check site/storage.js
node --check site/play/tetris/launcher.js
node --check site/play/tetris/runtime.js
node --check site/play/sml/launcher.js
node --check site/play/sml/runtime.js

if git ls-files | grep -E '\.(gb|gbc|gba|wasm)$' >/dev/null; then
  printf 'A cartridge or generated WebAssembly artifact is tracked.\n' >&2
  exit 1
fi

if [[ -f site/runtime/tetris/manifest.json ]]; then
  python3 tests/check_bundle.py
  tetris_source_root="${TETRIS_SOURCE_DIR:-$repo_root/../native-gb-tetris-modern}"
  if [[ -x "$tetris_source_root/scripts/audit-distribution.py" ]]; then
    tetris_audit_args=()
    for artifact in site/runtime/tetris/*.js site/runtime/tetris/*.wasm; do
      [[ -f "$artifact" ]] && tetris_audit_args+=(--artifact "$artifact")
    done
    tetris_rom="${TETRIS_TEST_ROM:-$tetris_source_root/roms/Tetris (JUE) (V1.1) [!].gb}"
    [[ -f "$tetris_rom" ]] && tetris_audit_args+=(--rom "$tetris_rom")
    "$tetris_source_root/scripts/audit-distribution.py" "${tetris_audit_args[@]}"
  fi
fi

if [[ -f site/runtime/sml/manifest.json ]]; then
  python3 tests/check_sml_bundle.py
  sml_source_root="${SML_SOURCE_DIR:-$repo_root/../native-gb-super-mario-land-modern}"
  if [[ -x "$sml_source_root/scripts/audit-distribution.py" ]]; then
    sml_audit_args=()
    for artifact in site/runtime/sml/*.js site/runtime/sml/*.wasm; do
      [[ -f "$artifact" ]] && sml_audit_args+=(--artifact "$artifact")
    done
    sml_rom="${SML_TEST_ROM:-$sml_source_root/roms/Super Mario Land (World) (Rev A).gb}"
    [[ -f "$sml_rom" ]] && sml_audit_args+=(--rom "$sml_rom")
    "$sml_source_root/scripts/audit-distribution.py" "${sml_audit_args[@]}"
  fi
fi

if [[ "${NATIVE_GB_SKIP_BROWSER:-0}" != "1" && \
      -f site/runtime/tetris/manifest.json && \
      -f "${TETRIS_TEST_ROM:-../native-gb-tetris-modern/roms/Tetris (JUE) (V1.1) [!].gb}" ]]; then
  ./scripts/test-browser.sh
fi
if [[ "${NATIVE_GB_SKIP_BROWSER:-0}" != "1" && \
      -f site/runtime/sml/manifest.json && \
      -f "${SML_TEST_ROM:-../native-gb-super-mario-land-modern/roms/Super Mario Land (World) (Rev A).gb}" ]]; then
  ./scripts/test-sml-browser.sh
fi
git diff --check
