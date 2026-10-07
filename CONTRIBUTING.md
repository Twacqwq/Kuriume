# Contributing to Kuriume

Thanks for your interest in Kuriume! Contributions of any kind are welcome.

## Getting Started

1. Fork this repository
2. Clone your fork: `git clone https://github.com/<your-username>/Kuriume.git`
3. Use Node 26 (`.node-version`) and install Rust through rustup
4. Install dependencies: `just setup`. Rust reads `rust-toolchain.toml` automatically.
5. Create a branch: `git checkout -b feat/your-feature`

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

Playback providers implement `search`, `episodes`, and `resolve`. Resolution returns direct media or a background-only sniff plan; the platform boundary returns MP4/HLS `PlayableAsset` values for ArtPlayer. Catalog identity stays independent. Do not add foreground website players, CAPTCHA workflows, external-player handoff, or arbitrary JavaScript to source rules. See [the playback contract and verification record](docs/playback-review-2026-10-07.md).

Built-in sources must not require an account or user-entered key, or insert playback ads (including ads embedded in the video). Verify actual playback, not just a resolving URL. MX was removed after playback ads were reported; do not reintroduce it without reassessing this requirement.

New pages are auto-registered by creating files under `src/routes/`.

Adding a new Rust command requires:
1. Declare with `#[tauri::command]` in `src-tauri/src/`
2. Register in `generate_handler![]` in `src-tauri/src/lib.rs`
3. Call from frontend via `invoke()`

## Platforms and Distribution

Keep one repository and one product version; do not maintain per-platform
branches. Share catalog, matching, playback-provider, and store logic. Isolate
OS behavior at the Tauri/native boundary: media transport, source sniffing,
fullscreen, lifecycle, and installation/update delivery. Keep responsive UI
shared; iPhone and iPad are one iOS target, not separate products.

Use Tauri's [platform-specific configuration files](https://v2.tauri.app/develop/configuration-files/)
for actual platform differences, and Rust `cfg`/target dependencies for native
code. Add Swift/Kotlin bridges only where a required capability is not available
through Tauri. Do not scatter user-agent checks through UI components or create
empty platform abstractions in advance.

GitHub Releases is the distribution channel. TestFlight, App Store Connect,
Google Play, and fastlane are not part of this phase.

| Platform | Distribution | Current release workflow |
| --- | --- | --- |
| macOS Apple Silicon | DMG | Enabled; ad-hoc signed, not notarized |
| Windows x64 | NSIS EXE | Enabled; not code-signed |
| Android arm64 | Signed APK | Main artifacts and versioned releases; signing secrets required |
| iOS / iPadOS | Unsigned device IPA for user-managed re-signing | Main artifacts and versioned releases; no Apple credentials needed |

An IPA download is **not** directly installable like an APK. The IPA
must clearly state its signing requirements; users need a compatible sideloading
method and valid signing. Free-account signing, for example, requires periodic
refresh ([AltStore documentation](https://faq.altstore.io/altstore-classic/your-altstore)).
Do not describe a sideload IPA as an unsigned installable app or a TestFlight build.

Android release APKs must use a persistent signing key; back it up privately and
never commit it. Updates require a compatible signing identity and a higher
`versionCode` ([Android signing](https://developer.android.com/studio/publish/app-signing),
[versioning](https://developer.android.com/studio/publish/versioning)). Signing
secrets belong to GitHub Actions and trusted main/release jobs, never PR jobs. Keep the app
identifier stable across upgrades. The current app has no in-app updater; users
download and install a newer release. Do not add updater keys or `latest.json`
until the corresponding updater and signature verification are implemented.

### Mobile packages and signing

Mobile packages are available for testing; successful builds do not constitute
real-device playback acceptance. Native projects are tracked in
`src-tauri/gen/apple` and `src-tauri/gen/android`; targeted ignores exclude build
output, machine paths, dependency links and signing files.

The initial baseline is iOS/iPadOS 16.4+ and Android API 24+ with an updated
Android System WebView (Chromium 111+). The iOS minimum follows the existing
[Tailwind 4 browser requirements](https://tailwindcss.com/docs/compatibility),
not Tauri's lower native minimum. An old Android WebView is not a supported
runtime merely because the APK can install.

The shared React/ArtPlayer surface now adapts to phone and tablet widths. Native
capabilities live in `src-tauri/crates/tauri-plugin-mobile`, with Swift and Kotlin
implementations rather than desktop window APIs:

- Horizontal swipes preview a bounded seek, committed on release; left/right
  vertical swipes adjust screen brightness/device media volume. Controls, screen
  edges and multiple fingers are excluded. The normal progress bar remains usable.
- Brightness is restored on exit/background; volume remains a system preference.
  Backgrounding pauses video and saves progress; returning does not auto-resume.
- Phone fullscreen requests landscape; tablet/multi-window layout stays flexible.
  Android Back dismisses a modal, exits fullscreen, or returns through route history.
- Isolated native WebViews perform background-only source resolution without the
  application IPC bridge. URLs still pass the shared media validation/proxy.
- iOS uses session-scoped loopback HTTP for MP4, native HLS, and subtitles. HLS
  child playlists/segments/keys keep the same transport, scope and cookie rules.

On macOS with Xcode and xcodegen installed:

```bash
npm run ios:dev                       # Pick an installed simulator or device
npm run ios:build:sim                 # Apple Silicon simulator; no signing needed
npm run ios:build:ipa                 # Release iphoneos arm64 IPA, for re-signing
```

The IPA script builds the release Rust/Swift library with embedded frontend
assets, then uses Xcode with signing explicitly disabled. It validates the
executable's device platform, arm64 architecture, iPhone/iPad support, and version
before creating `Payload/Kuriume.app` inside the archive. It does not suppress a
failed Tauri export or repackage a simulator build. Tauri's normal signed
`ios dev/build` commands remain available separately.

Android needs JDK 17, SDK 36, build tools 35/36 and NDK 28.2.13676358. Set
`JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` for your installation; then install
the Rust target with `rustup target add aarch64-linux-android`.

```bash
npm run android:keygen                # Once only; creates private local signing files
npm run android:build:apk             # Release arm64 APK, signature and version checked
npm run android:dev                   # Optional device development
```

`android:keygen` refuses to overwrite existing files. Back up
`.local/android-signing/` privately: losing the signing key prevents an in-place
upgrade of installed copies. The builder reads that local credentials file, or
the four `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
and `ANDROID_KEY_PASSWORD` environment variables. Existing keystores can be used
via those variables. Never commit or paste signing passwords into an issue/chat.

**One-time GitHub setup:** add repository Actions secrets
`ANDROID_KEYSTORE_BASE64` (base64 of the keystore), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. These values must match your
local signing identity. Do not upload the keystore or credentials as an artifact.
The workflow fails with an explicit setup error if any secret is missing; it
never substitutes an unsigned APK, a changing debug certificate, or a new key.
No Apple account, development team, provisioning profile or TestFlight setup is
needed for the unsigned IPA. It still needs valid re-signing before installation.

The **Mobile packages** workflow runs on pushes to `main` and can also be run
manually. It only signs commits already reachable from `main`, never PR code.
Download `mobile-android-arm64` and `mobile-ios-unsigned` from the run's
**Artifacts** section. Artifacts include package checksums and expire after 14
days. Versioned releases call the same workflow and publish both mobile packages
alongside the desktop installers only when every required build succeeds.
Merging a feature PR produces test artifacts; it does not publish a new Release.

Product versions still come from `package.json`. Mobile builds share one UTC
minute number since 2020-01-01, computed once per workflow: Android uses it as
`versionCode`, iOS encodes it as 4/2/2-digit `CFBundleVersion` components. Builds
in different minutes increase; rebuilds within one minute retain their number.
This is independent of individual workflow run counters and keeps the full
prerelease product version in artifact filenames/Android `versionName`. Set
`KURIUME_BUILD_NUMBER` to the same validated number for reproducible local builds.
Source code rolled back for testing must still use a new build number, not an
older APK whose installation would be a downgrade. Output is in `artifacts/`.

Local checkpoint (2026-10-07): iOS simulator and macOS debug builds pass;
an unsigned iPhone/iPad arm64 IPA and a signed Android arm64 release APK also
build successfully. Package checks cover device architecture, version, APK
signature, release mode, and 16 KB ZIP alignment; the Android native library's
LOAD segments also use 16 KB alignment. The frontend tests, workspace Rust tests,
Clippy, and workflow syntax checks pass. The GitHub-hosted mobile workflow still
needs its first run after merging to main.
An iPhone 16 Pro / iOS 18.3 simulator played Frieren episode 1 through Anime1,
Xifan Next, and AGE's Hongniu line. AGE's initial VIP line returned no video;
switching lines recovered playback. Fullscreen and saved-position restoration
were exercised. The iPad simulator layout was inspected, but Split View and iPad
playback have not passed acceptance. Gesture handlers have synthetic-touch tests;
real swipe feel, device volume/brightness, and Android installation/playback
remain unverified on physical devices.

Local simulator validation is not real-device acceptance. Before calling mobile stable,
verify MP4/HLS with every provider, seek/Range, subtitle selection, sound, brightness
restoration, hardware volume/headphones/audio interruption, rotation, backgrounding,
Android Back, phone landscape, iPad Split View and large text. Android real-device
acceptance is the next step after installing the APK.

Verify actual installation and playback on iPhone, iPad, and Android before
advertising mobile support as stable. Signed build artifacts alone cannot verify
gesture feel, media playback, battery/brightness behavior, or source availability.

## Versioning and Release Workflow

`package.json` is the product version source; Tauri reads it directly. Cargo
workspace members inherit `workspace.package.version`. Release Please updates
the workspace version, local Cargo lock entries, npm lock, manifest, and changelog
in one release PR. `npm run check:version` rejects drift before a build. Do not
bump individual crates or platform files independently.

The Cargo lock JSONPath uses `name.value` because the pinned Release Please
17.3.0 TOML updater wraps scalar values with source-position metadata. When
upgrading that action, verify an in-memory stable/prerelease bump changes only
the four workspace entries, not dependency versions.

Supported tags are `vX.Y.Z` and `vX.Y.Z-alpha.N`, `-beta.N`, or `-rc.N`. The tag
must exactly match all version files. Do not move published version tags.

1. PRs targeting `main` and pushes to `main` run frontend checks and Rust
   checks/tests on macOS and Windows. Pushes to `main` also build mobile packages.
   Pushes to `v1` do not trigger CI. Live
   third-party-source tests remain opt-in.
2. Conventional commits on `main` feed Release Please. Review and merge its
   release PR to create a version tag and **draft** release. `v1` alone does not
   trigger automatic releases.
3. Release Please directly calls the reusable release workflow. It resolves the
   tag to a commit, validates the version, and runs CI and all desktop/mobile builds
   against that same commit.
4. After every required build succeeds, the publish job uploads installers and
   `SHA256SUMS`, then publishes the draft. Prerelease tags are not marked latest.
   A failed build leaves the draft unpublished; already public releases are not
   overwritten. Never manually publish a draft while its build is in progress.

For a failed draft build, rerun the failed workflow/jobs. Alternatively run
**Build and Release** manually with an existing matching version tag. A branch
name is not a release input. Protect version tags against deletion/force updates
and configure the `github-release` environment with any required reviewers.
Creating an environment in YAML alone does not enable approval protection.

The default `GITHUB_TOKEN` cannot trigger new workflows from its own events.
The direct workflow call handles release builds, but Release Please's bot PR may
still need a manual **CI** run with its branch as `ref`. Alternatively configure
the optional, narrowly scoped `RELEASE_PLEASE_TOKEN` so its PR triggers CI normally
([Release Please action documentation](https://github.com/googleapis/release-please-action)).
Enable GitHub Actions' permission to create pull requests in repository settings.
No token, environment protection, tag rule, or remote release is provisioned by
editing these files locally.

Node is selected from `.node-version` (26). Rust is pinned in
`rust-toolchain.toml`; update the matching toolchain inputs in Actions together.
Actions are pinned to reviewed commit SHAs. Toolchain/action upgrades should pass
the same checks before merging.

## Code Style

- **Frontend**: TypeScript strict mode. Use `cn()` to merge Tailwind classes.
- **Backend**: Zero `cargo clippy` warnings. Format with `cargo fmt`.
- Path alias `@/` maps to `src/`.

## License

All contributions are released under the [GPLv3](LICENSE) license.
