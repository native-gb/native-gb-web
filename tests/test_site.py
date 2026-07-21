import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


class SiteTest(unittest.TestCase):
    def test_catalog_has_verified_lazy_games(self):
        catalog = json.loads((SITE / "catalog.json").read_text())
        self.assertEqual(catalog["schema"], 1)
        self.assertEqual(len(catalog["games"]), 2)
        games = {game["id"]: game for game in catalog["games"]}
        self.assertEqual(games["tetris"]["roms"][0]["sha1"],
                         "74591cc9501af93873f9a5d3eb12da12c0723bbc")
        self.assertTrue(games["tetris"]["browser"]["ready"])
        self.assertEqual(games["tetris"]["browser"]["module"], "play/tetris/runtime.js")
        self.assertTrue(games["tetris"]["source_url"].endswith(
            "/tree/f302337d211fd736851e0d69ab0180a9ae7b4c33"))
        self.assertEqual(games["sml-modern"]["roms"][0]["sha1"],
                         "418203621b887caa090215d97e3f509b79affd3e")
        self.assertTrue(games["sml-modern"]["browser"]["ready"])
        self.assertEqual(games["sml-modern"]["browser"]["module"], "play/sml/runtime.js")
        self.assertTrue(games["sml-modern"]["source_url"].endswith(
            "/tree/d94d5e7f836ec4037e820fd9b5df88f8b5d52813"))

    def test_catalog_assets_and_play_route_exist(self):
        catalog = json.loads((SITE / "catalog.json").read_text())
        for game in catalog["games"]:
            self.assertTrue((SITE / game["image"]).is_file())
            self.assertTrue((SITE / game["play_url"] / "index.html").is_file())
        self.assertTrue((SITE / "assets/native-gb-mark.svg").is_file())

    def test_catalog_does_not_reference_a_runtime_bundle(self):
        index = (SITE / "index.html").read_text()
        self.assertNotIn(".wasm", index)
        self.assertNotIn("launcher.js", index)
        self.assertIn('src="catalog.js"', index)

    def test_play_routes_load_runtime_only_after_rom_verification(self):
        for route in ("tetris", "sml"):
            launcher = (SITE / f"play/{route}/launcher.js").read_text()
            runtime = (SITE / f"play/{route}/runtime.js").read_text()
            self.assertIn("crypto.subtle.digest", launcher)
            self.assertIn("await import", launcher)
            self.assertIn("manifest.json", runtime)
        self.assertNotIn("native-gb-tetris.js", (SITE / "index.html").read_text())

    def test_modern_runtime_does_not_name_or_import_reference_projects(self):
        runtime_sources = "\n".join(
            path.read_text(errors="ignore")
            for path in (ROOT / "runtime/sml").rglob("*") if path.is_file()
        ).lower()
        self.assertNotIn("super-mario-land-re", runtime_sources)
        self.assertNotIn("sml-reference", runtime_sources)

    def test_no_cartridge_or_extracted_media_is_tracked(self):
        forbidden = {".gb", ".gbc", ".gba", ".wav", ".ogg", ".mp3"}
        offenders = [path for path in SITE.rglob("*") if path.is_file() and path.suffix.lower() in forbidden]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
