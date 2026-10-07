# Contributing to Kuriume

Thanks for your interest in Kuriume! Contributions of any kind are welcome.

## Getting Started

1. Fork this repository
2. Clone your fork: `git clone https://github.com/<your-username>/Kuriume.git`
3. Install dependencies: `just setup`
4. Create a branch: `git checkout -b feat/your-feature`

## Development

```bash
# Full dev environment (Vite + Tauri)
just dev

# Frontend only
just dev-frontend

# Quick Rust compile check
just check
```

### VS Code Rust diagnostics

If the VS Code extension reports that your toolchain is unsupported, use the
rust-analyzer component matching your installed Rust toolchain:

```bash
rustup component add rust-analyzer
```

Set `"rust-analyzer.server.path": "rust-analyzer"` in local workspace settings
(`.vscode/settings.json`, intentionally ignored), then run **rust-analyzer:
Restart server**. This uses the rustup-managed analyzer on `PATH` without
upgrading the compiler or disabling diagnostics. Confirm real errors with
`cargo check --manifest-path src-tauri/Cargo.toml --workspace --all-targets`.

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: update documentation
chore: maintenance tasks
refactor: code refactoring
```

## Pull Request

1. Ensure code passes lint: `just lint`
2. Format Rust code: `just fmt`
3. Submit PR to the `main` branch
4. Describe your changes and motivation

## Project Structure

- `src/` — Frontend (React + TypeScript). Route files go in `src/routes/`
- `src-tauri/src/` — Tauri commands
- `src-tauri/crates/` — Rust libraries for catalog/source providers and the local store

Playback providers implement `search`, `episodes`, and `resolve`. Resolution returns direct media or a background-only sniff plan; the desktop boundary returns MP4/HLS `PlayableAsset` values for ArtPlayer. Catalog identity stays independent. Do not add foreground website players, CAPTCHA workflows, external-player handoff, or arbitrary JavaScript to source rules. See [the playback contract and verification record](docs/playback-review-2026-10-07.md).

Built-in sources must not require an account or user-entered key, or insert playback ads (including ads embedded in the video). Verify actual playback, not just a resolving URL. MX was removed after playback ads were reported; do not reintroduce it without reassessing this requirement.

New pages are auto-registered by creating files under `src/routes/`.

Adding a new Rust command requires:
1. Declare with `#[tauri::command]` in `src-tauri/src/`
2. Register in `generate_handler![]` in `src-tauri/src/lib.rs`
3. Call from frontend via `invoke()`

## Code Style

- **Frontend**: TypeScript strict mode. Use `cn()` to merge Tailwind classes.
- **Backend**: Zero `cargo clippy` warnings. Format with `cargo fmt`.
- Path alias `@/` maps to `src/`.

## License

All contributions are released under the [GPLv3](LICENSE) license.
