# Kuriume — cross-platform task runner

default:
    @just --list

# Install JavaScript dependencies. Rust dependencies are resolved by Cargo.
setup:
    npm ci

# Start Vite and the Tauri desktop shell.
dev:
    npm run tauri dev

# Start only the frontend. Tauri commands are unavailable in this mode.
dev-frontend:
    npm run dev

# Build the desktop application.
build:
    npm run tauri build

# Run frontend and Rust compile checks.
check:
    npm run build
    cargo check --manifest-path src-tauri/Cargo.toml --workspace

# Run Rust tests.
test:
    cargo test --manifest-path src-tauri/Cargo.toml --workspace

# Run Clippy with warnings denied.
lint:
    cargo clippy --manifest-path src-tauri/Cargo.toml --workspace -- -D warnings

# Format Rust code.
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml --all

# Remove generated build artifacts.
clean:
    rm -rf dist
    cargo clean --manifest-path src-tauri/Cargo.toml
