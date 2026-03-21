#!/usr/bin/env python3
"""
Collect libmpv and ALL its transitive non-system dylib dependencies,
copy them into src-tauri/libs/macos/, rewrite inter-library references
to @loader_path/, and update tauri.conf.json so Tauri bundles them
into Contents/Frameworks/.

Usage:
    python3 scripts/bundle-libs-macos.sh [/path/to/libmpv.2.dylib]

If no argument is given, auto-detects via Homebrew.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
LIBS_DIR = PROJECT_DIR / "src-tauri" / "libs" / "macos"
TAURI_CONF = PROJECT_DIR / "src-tauri" / "tauri.conf.json"

# VapourSynth + Python are optional mpv deps, not needed for playback
EXCLUDE_PATTERNS = ["vapoursynth", "Python", "python"]


def find_libmpv() -> Path:
    """Locate libmpv.2.dylib."""
    if len(sys.argv) > 1:
        p = Path(sys.argv[1]).resolve()
        if p.exists():
            return p
        print(f"ERROR: {sys.argv[1]} not found", file=sys.stderr)
        sys.exit(1)

    for candidate in ["/opt/homebrew/lib/libmpv.2.dylib", "/usr/local/lib/libmpv.2.dylib"]:
        p = Path(candidate)
        if p.exists():
            return p.resolve()

    print("ERROR: libmpv.2.dylib not found. Install via: brew install mpv", file=sys.stderr)
    sys.exit(1)


def otool_deps(lib: Path) -> list[str]:
    """Return list of non-system dylib paths that `lib` depends on."""
    result = subprocess.run(["otool", "-L", str(lib)], capture_output=True, text=True)
    deps = []
    for line in result.stdout.strip().split("\n")[1:]:  # skip first line (self)
        m = re.match(r"\s+(/\S+)", line)
        if m:
            path = m.group(1)
            # Only collect Homebrew / non-system deps
            if "/opt/homebrew/" in path or "/usr/local/Cellar/" in path:
                deps.append(path)
    return deps


def otool_id(lib: Path) -> str:
    """Return the install name (id) of a dylib."""
    result = subprocess.run(["otool", "-D", str(lib)], capture_output=True, text=True)
    lines = result.stdout.strip().split("\n")
    return lines[-1].strip() if len(lines) > 1 else ""


def should_exclude(path: Path) -> bool:
    """Check if a library should be excluded from bundling."""
    name = path.name.lower()
    return any(pat.lower() in name for pat in EXCLUDE_PATTERNS)


def resolve_all_deps(root: Path) -> list[Path]:
    """Recursively resolve all transitive non-system dylib dependencies."""
    seen: set[Path] = set()
    ordered: list[Path] = []
    queue = [root]

    while queue:
        lib = queue.pop(0)
        real = lib.resolve()
        if real in seen:
            continue
        seen.add(real)

        if should_exclude(real):
            print(f"  Excluding: {real.name}")
            continue

        ordered.append(real)

        for dep in otool_deps(real):
            dep_real = Path(dep).resolve()
            if dep_real not in seen and dep_real.exists():
                queue.append(dep_real)

    return ordered


def main():
    libmpv = find_libmpv()
    print(f"==> Root library: {libmpv}")

    # 1. Resolve all transitive dependencies
    all_libs = resolve_all_deps(libmpv)
    print(f"==> Found {len(all_libs)} libraries to bundle")

    # 2. Clean and create staging directory
    if LIBS_DIR.exists():
        shutil.rmtree(LIBS_DIR)
    LIBS_DIR.mkdir(parents=True)

    # 3. Copy all dylibs to staging, record install_name → basename mapping
    name_map: dict[str, str] = {}  # original install_name → filename
    for lib in all_libs:
        basename = lib.name
        dest = LIBS_DIR / basename

        if dest.exists():
            print(f"  WARNING: duplicate basename {basename}, skipping {lib}")
            continue

        shutil.copy2(lib, dest)
        dest.chmod(0o755)

        install_name = otool_id(lib)
        if install_name:
            name_map[install_name] = basename

        print(f"  Copied: {basename}")

    # 4. Rewrite inter-library references to @loader_path/
    print("==> Rewriting install names...")
    for lib_file in sorted(LIBS_DIR.glob("*.dylib")):
        basename = lib_file.name

        # Change the library's own id
        subprocess.run(
            ["install_name_tool", "-id", f"@loader_path/{basename}", str(lib_file)],
            capture_output=True,
        )

        # Rewrite references to other Homebrew libs
        for dep in otool_deps(lib_file):
            # Resolve target filename
            target = name_map.get(dep)
            if not target:
                dep_real = Path(dep).resolve()
                dep_id = otool_id(dep_real)
                target = name_map.get(dep_id, dep_real.name)

            subprocess.run(
                ["install_name_tool", "-change", dep, f"@loader_path/{target}", str(lib_file)],
                capture_output=True,
            )

    # 5. Verify no Homebrew references remain
    print("==> Verifying...")
    leaks = 0
    for lib_file in sorted(LIBS_DIR.glob("*.dylib")):
        bad = [d for d in otool_deps(lib_file)]
        if bad:
            print(f"  WARNING: {lib_file.name} still references:")
            for b in bad:
                print(f"    {b}")
            leaks += 1

    if leaks == 0:
        print("  All references rewritten successfully.")
    else:
        print(f"  {leaks} libraries have remaining external references.")

    # 6. Update tauri.conf.json
    print("==> Updating tauri.conf.json...")
    with open(TAURI_CONF) as f:
        conf = json.load(f)

    frameworks = sorted(f"libs/macos/{p.name}" for p in LIBS_DIR.glob("*.dylib"))

    conf.setdefault("bundle", {}).setdefault("macOS", {})["frameworks"] = frameworks

    with open(TAURI_CONF, "w") as f:
        json.dump(conf, f, indent=2)
        f.write("\n")

    print(f"==> Done! {len(all_libs)} dylibs staged in src-tauri/libs/macos/")
    print(f"==> tauri.conf.json updated with {len(frameworks)} framework entries.")
    print()
    print("Now run: npm run tauri build")


if __name__ == "__main__":
    main()
