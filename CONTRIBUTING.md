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
- `src-tauri/crates/` — Rust libraries (provider, mpv, torrent, store)

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
