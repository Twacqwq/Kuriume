# Kuriume — cross-platform task runner
# Install: cargo install just  |  brew install just  |  choco install just
#
# Usage:
#   just setup       # Install all dependencies (platform-aware)
#   just dev         # Start dev environment
#   just build       # Production build
#   just bundle-libs # Collect native libs for distribution (macOS)
#   just clean       # Clean build artifacts

# Default recipe: show available commands
default:
    @just --list

# ── Setup ─────────────────────────────────────────────────────────

# Install all dependencies for the current platform
setup: _setup-native
    npm ci

# Platform-specific native dependency setup
[macos]
_setup-native:
    @echo "==> Installing macOS dependencies..."
    brew install mpv
    @echo "==> Done. Run 'just bundle-libs' before 'just build' for distribution."

[linux]
_setup-native:
    @echo "==> Installing Linux dependencies..."
    sudo apt-get update
    sudo apt-get install -y \
        libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
        libmpv-dev
    @echo "==> Done."

[windows]
_setup-native:
    @echo "==> Windows: please install mpv manually."
    @echo "   Download libmpv from: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/"
    @echo "   Set MPV_LIB_DIR to the directory containing mpv.lib"

# ── Development ───────────────────────────────────────────────────

# Start full dev environment (Vite + Tauri)
dev:
    npm run tauri dev

# Start frontend only (no Tauri backend)
dev-frontend:
    npm run dev

# ── Build ─────────────────────────────────────────────────────────

# Build for production (run 'just bundle-libs' first on macOS)
build:
    npm run tauri build

# Cargo check (fast compile check, no linking)
check:
    cargo check --manifest-path src-tauri/Cargo.toml

# ── Native Library Bundling ───────────────────────────────────────

# Collect and rewrite native dylibs for macOS distribution
[macos]
bundle-libs:
    python3 scripts/bundle-libs-macos.sh

[linux]
bundle-libs:
    @echo "Linux: native libs are handled by the package manager at install time."
    @echo "For AppImage, libraries are bundled automatically by linuxdeploy."

[windows]
bundle-libs:
    @echo "Windows: copy mpv-2.dll to src-tauri/libs/windows/ and set MPV_LIB_DIR."

# ── Clean ─────────────────────────────────────────────────────────

# Remove build artifacts
clean:
    rm -rf dist
    cargo clean --manifest-path src-tauri/Cargo.toml
    rm -rf src-tauri/libs

# ── Utilities ─────────────────────────────────────────────────────

# Run cargo clippy for linting
lint:
    cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Format Rust code
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml
