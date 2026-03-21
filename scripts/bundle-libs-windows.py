#!/usr/bin/env python3
"""
Download pre-built libmpv for Windows from shinchiro/mpv-winbuild-cmake,
stage DLL and linking files into src-tauri/libs/windows/,
generate MSVC import library, and print build instructions.

Usage:
    python3 scripts/bundle-libs-windows.py [/path/to/mpv-dev-dir]

If no argument is given, downloads the latest build from GitHub.
Respects GITHUB_TOKEN env var for authenticated API requests.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, NoReturn

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
LIBS_DIR = PROJECT_DIR / "src-tauri" / "libs" / "windows"
TAURI_CONF = PROJECT_DIR / "src-tauri" / "tauri.conf.json"

GITHUB_API = "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest"


def _fatal(msg: str) -> NoReturn:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def find_latest_dev_url() -> str:
    """Query GitHub API for the latest mpv-dev-x86_64 asset URL."""
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "kuriume-bundle"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(GITHUB_API, headers=headers)
    with urllib.request.urlopen(req) as resp:
        data: dict[str, Any] = json.loads(resp.read())

    for asset in data.get("assets", []):
        name: str = asset["name"]
        if "mpv-dev-x86_64" in name and name.endswith(".7z"):
            return asset["browser_download_url"]

    _fatal("mpv-dev-x86_64 asset not found in latest release")


def download_and_extract(dest_dir: Path) -> Path:
    """Download and extract mpv dev package."""
    url = find_latest_dev_url()
    archive = dest_dir / "mpv-dev.7z"

    print("==> Downloading mpv dev package...")
    print(f"    URL: {url}")
    urllib.request.urlretrieve(url, archive)
    size_mb = archive.stat().st_size / 1024 / 1024
    print(f"    Downloaded: {size_mb:.1f} MB")

    extract_dir = dest_dir / "mpv-dev"
    extract_dir.mkdir(exist_ok=True)

    print("==> Extracting...")
    subprocess.run(
        ["7z", "x", str(archive), f"-o{extract_dir}", "-y"],
        check=True,
        capture_output=True,
    )

    return extract_dir


def find_dev_dir() -> Path:
    """Locate or download mpv dev directory."""
    if len(sys.argv) > 1:
        p = Path(sys.argv[1]).resolve()
        if p.is_dir():
            return p
        _fatal(f"{sys.argv[1]} is not a directory")

    tmp = Path(tempfile.mkdtemp(prefix="kuriume-mpv-"))
    return download_and_extract(tmp)


def find_file(base: Path, *names: str) -> Path | None:
    """Find a file by trying multiple names, including in subdirectories."""
    for name in names:
        direct = base / name
        if direct.exists():
            return direct
        found = list(base.rglob(name))
        if found:
            return found[0]
    return None


def generate_msvc_lib(def_file: Path, out_dir: Path) -> bool:
    """Generate mpv.lib from .def file using MSVC lib.exe."""
    out_lib = out_dir / "mpv.lib"
    try:
        subprocess.run(
            ["lib", f"/DEF:{def_file}", f"/OUT:{out_lib}", "/MACHINE:X64"],
            check=True,
            capture_output=True,
        )
        print(f"    Generated mpv.lib ({out_lib.stat().st_size / 1024:.0f} KB)")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("    WARNING: lib.exe not available, skipping mpv.lib generation")
        print("    Run from a VS Developer Command Prompt to generate mpv.lib")
        return False


def main() -> None:
    dev_dir = find_dev_dir()
    print(f"==> mpv dev directory: {dev_dir}")

    dll = find_file(dev_dir, "libmpv-2.dll", "mpv-2.dll")
    if not dll:
        _fatal("libmpv-2.dll / mpv-2.dll not found in dev package")

    # 1. Clean and create staging directory
    if LIBS_DIR.exists():
        shutil.rmtree(LIBS_DIR)
    LIBS_DIR.mkdir(parents=True)

    # 2. Copy runtime DLL (keep original name — the import library references it)
    print("==> Copying runtime DLL...")
    dest_dll = LIBS_DIR / dll.name
    shutil.copy2(dll, dest_dll)
    size_mb = dest_dll.stat().st_size / 1024 / 1024
    print(f"    {dll.name} ({size_mb:.1f} MB)")

    # 3. Copy MinGW import library if present (fallback for GNU toolchain)
    dll_a = find_file(dev_dir, "libmpv.dll.a")
    if dll_a:
        shutil.copy2(dll_a, LIBS_DIR / "libmpv.dll.a")
        print("    libmpv.dll.a")

    # 4. Generate MSVC import library from .def file
    def_file = find_file(dev_dir, "libmpv-2.def", "mpv.def")
    if def_file:
        shutil.copy2(def_file, LIBS_DIR / def_file.name)
        print(f"    {def_file.name}")
        generate_msvc_lib(def_file, LIBS_DIR)

    # 5. Update tauri.conf.json — add Windows resources if not present
    print("==> Updating tauri.conf.json...")
    with open(TAURI_CONF, encoding="utf-8") as f:
        conf: dict[str, Any] = json.load(f)

    bundle: dict[str, Any] = conf.setdefault("bundle", {})
    resources: dict[str, str] = bundle.get("resources", {})
    if isinstance(resources, list):
        resources = {}

    dll_pattern = "libs/windows/*.dll"
    if dll_pattern not in resources:
        resources[dll_pattern] = "."
        bundle["resources"] = resources

        with open(TAURI_CONF, "w", encoding="utf-8") as f:
            json.dump(conf, f, indent=2)
            f.write("\n")
        print(f"    Added resource mapping: {dll_pattern} -> .")
    else:
        print("    Resource mapping already present.")

    print("\n==> Done! Files staged in src-tauri/libs/windows/")
    dll_count = len(list(LIBS_DIR.glob("*.dll")))
    print(f"    {dll_count} DLL(s) ready for bundling")


if __name__ == "__main__":
    main()
