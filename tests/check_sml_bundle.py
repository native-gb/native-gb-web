import hashlib
import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "site/runtime/sml"


def fail(message):
    raise SystemExit(message)


manifest = json.loads((RUNTIME / "manifest.json").read_text())
if manifest.get("schema") != 1:
    fail("unsupported SML Modern browser runtime manifest")
pin_text = (ROOT / "runtime/sml/source-version.sh").read_text()
pin_match = re.search(r'readonly sml_source_commit="([0-9a-f]{40})"', pin_text)
if not pin_match or manifest.get("source_commit") != pin_match.group(1):
    fail("SML Modern runtime was not built from the pinned source commit")

bundles = []
for field, suffix in (("module", ".js"), ("wasm", ".wasm")):
    name = manifest.get(field, "")
    path = RUNTIME / name
    if not name.endswith(suffix) or not path.is_file():
        fail(f"SML Modern runtime manifest has no valid {field} file")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if f".{digest[:16]}{suffix}" not in name:
        fail(f"SML Modern {field} filename does not match its content hash")
    bundles.append(path.read_bytes())

combined = b"\n".join(bundles)
for marker in (
    b"mGBA",
    b"GBRE Scenario",
    b"super-mario-land-re",
    b"native-gb-super-mario-land-reference",
    b"Super Mario Land (World) (Rev A).gb",
):
    if marker.lower() in combined.lower():
        fail(f"private, reference, or cartridge marker appears in SML Modern bundle: {marker.decode()}")

home = os.environ.get("HOME", "").encode()
if home and home in combined:
    fail("the SML Modern browser bundle contains the build machine's home path")

rom_name = os.environ.get(
    "SML_TEST_ROM",
    str(ROOT.parent / "native-gb-super-mario-land-modern/roms/Super Mario Land (World) (Rev A).gb"),
)
rom_path = Path(rom_name)
if rom_path.is_file():
    rom = rom_path.read_bytes()
    for offset in range(0, len(rom) - 64, 257):
        sample = rom[offset:offset + 64]
        if len(set(sample)) >= 8 and sample in combined:
            fail(f"SML Modern browser bundle contains cartridge bytes from offset 0x{offset:04x}")

print("SML Modern browser bundle audit passed")
