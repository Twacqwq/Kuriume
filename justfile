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
    npm run check:version
    npm run build
    cargo check --manifest-path src-tauri/Cargo.toml --workspace --all-targets --locked

# Run offline frontend regressions and Rust tests (live source tests opt in).
test:
    npm test
    cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked

# Run Clippy with warnings denied.
lint:
    cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets --locked -- -D warnings

# Format Rust code.
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml --all

# Remove generated build artifacts.
clean:
    rm -rf dist
    cargo clean --manifest-path src-tauri/Cargo.toml
