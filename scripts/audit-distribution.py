#!/usr/bin/env python3

import argparse
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MEDIA_SUFFIXES = {
    ".gb", ".gbc", ".gba", ".sav", ".ss0", ".ss1", ".ss2", ".png",
    ".gif", ".jpg", ".jpeg", ".webp", ".bmp", ".wav", ".flac", ".ogg",
    ".mp3", ".wasm",
}
TEXT_SUFFIXES = {
    "", ".css", ".html", ".js", ".json", ".md", ".py", ".sh", ".svg",
    ".txt", ".xml", ".yml", ".yaml",
}
PRIVATE_RUNTIME_MARKERS = (
    b"native-gb-super-mario-land-re",
    b"native-gb-tetris-re",
    b"GBRE Scenario",
    b"gbre_live",
    b"mGBA",
)
SECRET_PATTERNS = (
    re.compile(rb"BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{20,}"),
)


def git(*arguments, check=True):
    return subprocess.run(
        ["git", "-C", str(ROOT), *arguments], check=check,
        capture_output=True, text=True,
    )


def git_lines(*arguments):
    return git(*arguments).stdout.splitlines()


def has_git_history():
    result = git("rev-parse", "--is-inside-work-tree", check=False)
    return result.returncode == 0 and result.stdout.strip() == "true"


def fail(message):
    raise SystemExit(message)


def publication_files():
    if has_git_history():
        return git_lines("ls-files", "--cached", "--others", "--exclude-standard")
    return [
        path.relative_to(ROOT).as_posix()
        for path in ROOT.rglob("*")
        if path.is_file()
    ]


def audit_text(data, name):
    lowered = data.lower()
    unix_home = b"/" + b"home/"
    windows_home = b"c:" + b"\\users\\"
    if unix_home in lowered or windows_home in lowered:
        fail(f"machine-specific home path remains in {name}")
    for pattern in SECRET_PATTERNS:
        if pattern.search(data):
            fail(f"credential-like text remains in {name}")

    if name.startswith(("site/", "runtime/")):
        for marker in PRIVATE_RUNTIME_MARKERS:
            if marker.lower() in lowered:
                fail(f"private reference runtime marker remains in {name}: {marker.decode()}")


def audit_current_tree():
    for name in publication_files():
        suffix = Path(name).suffix.lower()
        if suffix in MEDIA_SUFFIXES:
            fail(f"publication tree contains cartridge, extracted media, or generated output: {name}")
        if suffix in TEXT_SUFFIXES:
            audit_text((ROOT / name).read_bytes(), name)


def audit_history():
    if not has_git_history():
        return

    text_objects = {}
    for record in git_lines("rev-list", "--objects", "--all"):
        fields = record.split(" ", 1)
        if len(fields) != 2:
            continue
        object_id, name = fields
        suffix = Path(name).suffix.lower()
        if suffix in MEDIA_SUFFIXES:
            fail(f"cartridge, extracted media, or generated output remains in Git history: {name}")
        object_type = git("cat-file", "-t", object_id).stdout.strip()
        if object_type == "blob" and suffix in TEXT_SUFFIXES:
            text_objects.setdefault(object_id, name)

    for object_id, name in text_objects.items():
        result = subprocess.run(
            ["git", "-C", str(ROOT), "cat-file", "blob", object_id],
            check=True, capture_output=True,
        )
        audit_text(result.stdout, f"Git history ({name}, blob {object_id[:12]})")


def main():
    parser = argparse.ArgumentParser(description="Audit the Native GB website boundary")
    parser.add_argument(
        "--current-only", action="store_true",
        help="audit the publication snapshot without examining pre-rewrite Git history",
    )
    arguments = parser.parse_args()

    audit_current_tree()
    if not arguments.current_only:
        audit_history()
    print("Native GB website distribution boundary audit passed")


if __name__ == "__main__":
    main()
