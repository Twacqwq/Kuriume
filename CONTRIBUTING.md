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

### App icons

`public/icon.png` is the source used by both the UI and native app icons. After
changing it (or initializing a mobile project), run `npm run icons:generate`.
The [Tauri icon command](https://v2.tauri.app/develop/icons/) updates desktop
resources in `src-tauri/icons` and the launcher/AppIcon assets directly in the
Android and iOS projects. Commit those generated assets together with the source.
CI regenerates them and checks PNG/ICO and mobile assets for stale or missing
files (ICNS entry ordering is nondeterministic). Changing the UI image alone does
not change an installed app's launcher icon. iOS icons are flattened on white.

### In-app diagnostics

Open **Settings → Logs & diagnostics** after reproducing a problem, then copy
the relevant page into the report. Logs are process-local: restarting the app
clears them. They are never written to a file/database or uploaded automatically.
Clipboard copying happens only on request; WebViews without clipboard support
offer selectable text instead. The viewer presents chronological text lines with
`[INFO]`, `[WARN]`, and `[ERROR]`, operation IDs, specific actions and error reasons.
Live mode refreshes the latest bounded page every two seconds; older pages, hidden
windows, selected text and open dialogs suspend polling. Pause updates freezes
the viewer, not log collection.

The Rust buffer retains at most **1 MiB of serialized log content and 1,000
entries**, evicting oldest entries first. Individual records are capped at 4 KiB;
identical consecutive events within two seconds are coalesced. These limits are
not a claim about total application RAM: container overhead, a bounded frontend
queue (32 pending + 8 in-flight records), and one 50-entry UI page also use memory.
Recording is best-effort and never blocks playback waiting for the log lock.

Use `diagnostics::record` / `diagnose` with the shared event/action codes and typed
fields. Error messages and bounded cause chains are retained after redaction,
with a 1 KiB UTF-8 message limit. The frontend queue and Rust storage both redact
URLs, credential assignments, local paths, emails and opaque tokens, and flatten
control characters. Never pass response bodies, stack traces, titles, search
terms, device IDs or headers as messages: pattern redaction cannot identify every
possible secret in arbitrary text. Separate URL/cookie/token fields remain rejected.
Capture source/catalog outcomes, media failures, initial playback, sustained
buffering, play/pause/background transitions, seeks and native-control failures—not every timeupdate or successful
HLS fragment. Resolution operation IDs correlate Rust/media/player events within
this run; they do not identify a user or survive restart. This is not a persistent
crash reporter; copy before restarting if the UI remains usable.

Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --lib diagnostics`
for the queue bounds, byte/count eviction, pagination, clearing and privacy checks.

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

Home and calendar share the query options in `src/lib/catalog-queries.ts`.
Startup reads the saved display language once, then prefetches both independently.
Their data stays fresh for 30 minutes and unused caches are collected after one
hour; settings remain cached for the process lifetime. Warm tab loaders must be
synchronous, with existing data visible during background refresh. The home grid
reuses the hero's first-page query and original timestamp. Language reloads
invalidate localized queries and warm both catalogs, without persisting API data.

Chinese titles are resolved by exact AniList ID from the bundled
`anilist-chinese.json` snapshot in the common `Media` → `AnimeInfo` conversion.
Display keeps the original punctuation and converts traditional characters to
simplified Chinese; search normalization is a separate, lazily built index.
Missing entries fall back to AniList Chinese aliases, then the existing native
title display fallback. Lists, calendar and search never wait for Bangumi title
lookups. Detail-only synopsis enrichment remains optional and cannot override a
known local title. Update the snapshot with `scripts/update-anilist-aliases.mjs`
using a reviewed immutable upstream revision; keep its embedded license.

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
| macOS Apple Silicon (M-series) | arm64 DMG and `.app.tar.gz` | Ad-hoc by default; optional Developer ID signing + notarization; no Intel build |
| Windows x64 | NSIS EXE and MSI | Enabled; not code-signed |
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

### Apple distribution outside the App Store

For ordinary macOS downloads, the supported path is **Developer ID Application
signing + hardened runtime + Apple notarization + a stapled ticket**. Creating a
DMG or ad-hoc signing alone does not establish Gatekeeper trust. A paid Apple
Developer Program account is needed for this public distribution path; users
can still see the normal first-open confirmation. See
[Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) and
[Apple's notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
Never ask users to globally disable Gatekeeper to compensate for unsigned builds.

Signing is **disabled by default**. When credentials become available:

1. Add repository Actions secrets `APPLE_CERTIFICATE` (base64 P12),
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (the full
   `Developer ID Application: ...` identity), `APPLE_ID`, `APPLE_PASSWORD`
   (an app-specific password, not the account password), and `APPLE_TEAM_ID`.
2. Set the repository Actions **variable** `MACOS_SIGNING_ENABLED=true`.
3. Build a commit already on main. Tauri imports the P12 into a temporary
   keychain and handles signing/notarization. The workflow verifies the arm64
   architecture, the code signature, the stapled ticket and Gatekeeper
   assessment before labeling the package `notarized`.

Enabling signing with missing/invalid credentials fails the build; it never
silently falls back to ad-hoc. Without the flag, Apple credentials are not passed
to the builder, and the manifest clearly records `ad-hoc`. Do not confuse OS
code signing with Tauri updater signatures. Windows Authenticode is not configured.

iOS/iPadOS cannot generally reproduce the Mac's “download DMG and install”
experience, particularly for our users in mainland China. Our current route is
a clearly labeled unsigned IPA plus user-managed re-signing, for example through
[AltStore Classic](https://faq.altstore.io/altstore-classic/your-altstore).
Free-account installs need refresh within seven days, and initial setup uses
[AltServer on a computer](https://faq.altstore.io/altstore-classic/altserver).
Publishing an IPA or an AltStore source does not remove Apple's signing rules.
Apple's [EU Web Distribution](https://developer.apple.com/support/web-distribution-eu/)
requires eligible developers, authorized domains and notarized apps; it is not
a general GitHub-IPA installation channel for mainland users. No TestFlight,
enterprise certificate, or paid third-party signing service is introduced here.

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
- Android WebView owns media audio focus, including interruption handling. The
  native controls plugin must not request a second audio focus: it can pause the
  video immediately on Play. Its session only manages brightness and screen wake.
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

After checks pass on a push to `main`, **CI** calls the shared **Build packages**
workflow for desktop and mobile. That workflow can also be run manually for a
commit already reachable from main; PR code never receives signing secrets.
Download `packages-macos-arm64`, `packages-windows-x64`,
`packages-android-arm64`, and `packages-ios-unsigned` from the CI run's
**Artifacts** section or its summary links. They expire after 14 days.
Versioned releases use the identical builders with a `release-` artifact prefix.
Merging an ordinary feature PR produces test artifacts, not a public Release.

`.github/actions/package-artifact` is the one upload/staging entry point. It
accepts only the expected installer files, normalizes names to
`Kuriume-<version>-<platform>.<extension>` (for example
`Kuriume-0.2.0-android-arm64.apk`), records commit/version/
build number/signing status and SHA-256 checksums, and avoids recompressing
already compressed packages. It never uploads the full target tree, credentials
or native intermediates. The release job verifies all six packages against the
same identity and hashes before copying only approved files to its upload folder.
`build-manifest.json` is a traceability record, not a cryptographic attestation.

Product versions still come from `package.json`. Mobile builds share one UTC
minute number since 2020-01-01, computed once per workflow: Android uses it as
`versionCode`, iOS encodes it as 4/2/2-digit `CFBundleVersion` components. Builds
in different minutes increase; rebuilds within one minute retain their number.
This is independent of individual workflow run counters and keeps the full
prerelease product version in artifact filenames/Android `versionName`; the
build number is in the packages, the step summary and `build-manifest.json`,
not in filenames. Set
`KURIUME_BUILD_NUMBER` to the same validated number for reproducible local builds.
Source code rolled back for testing must still use a new build number, not an
older APK whose installation would be a downgrade. Output is in `artifacts/`.

Local checkpoint (2026-10-07): iOS simulator and macOS debug builds pass;
an unsigned iPhone/iPad arm64 IPA and a signed Android arm64 release APK also
build successfully. Package checks cover device architecture, version, APK
signature, release mode, and 16 KB ZIP alignment; the Android native library's
LOAD segments also use 16 KB alignment. The frontend tests, workspace Rust tests,
Clippy, and workflow syntax checks pass. Subsequent GitHub mobile runs have
succeeded; the expanded macOS App archive/MSI pipeline and optional notarization
still require their first hosted run after merging this CI change.
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
workspace members inherit `workspace.package.version`. `npm run check:version`
rejects drift before a build. Do not bump individual crates or platform files
by hand; the release script changes them together.

Supported tags are `vX.Y.Z` and `vX.Y.Z-alpha.N`, `-beta.N`, or `-rc.N`. The tag
must exactly match all version files. Do not move published version tags.

Day to day, merge into `main` freely: nothing is versioned until you decide to
release. PRs targeting `main` and pushes to `main` run frontend checks and Rust
checks/tests on macOS and Windows, and successful pushes to `main` build all
four platform groups through `build-packages.yml`. Live third-party-source tests
remain opt-in.

To release:

1. On an up-to-date, clean `main`, run `npm run release -- 0.3.0` (or
   `0.3.0-beta.1`). It creates the branch `release/v0.3.0`, writes the version
   to `package.json`, `package-lock.json`, the Cargo workspace and the workspace
   entries of `Cargo.lock`, and commits `chore(release): v0.3.0`. It refuses a
   dirty tree, an existing tag or branch, or a version that is not newer.
2. `git push origin release/v0.3.0`, open a pull request into `main` and merge
   it with any merge method. Then
   `git switch main && git pull && git branch -D release/v0.3.0`.
   Alternatively run **Prepare Release** from the Actions tab with the version:
   it pushes the branch and opens the pull request for you. That needs "Allow
   GitHub Actions to create and approve pull requests" in the repository's
   Actions settings, and its pull request starts no checks; close and reopen it
   if `main` requires them.
3. Merging starts **Tag Release** (`release-tag.yml`). It checks that the
   merged version files match the branch name, tags the merged commit on `main`
   `v0.3.0` and calls **Build and Release**. Tagging only after the merge keeps
   the signing builds to code already in `main`.
4. **Build and Release** resolves the tag to a commit, validates the version,
   runs CI and every desktop/mobile build against that commit, then uploads
   installers, `SHA256SUMS` and `build-manifest.json` to a **draft** release.
   The draft's notes are written from the conventional commits since the
   previous version tag (`scripts/release-notes.mjs`): breaking changes,
   features, fixes and performance work. A version tag on `main` pushed by hand
   starts the same build.
5. Edit the notes on GitHub and publish the draft yourself. Installed apps only
   see published releases; prerelease tags are marked prerelease and never
   become latest.

A failed build leaves the draft unpublished; already public releases are not
overwritten. Rerun the failed jobs, or run **Build and Release** manually with
the existing tag. A full rerun removes superseded generated installers from that
unpublished draft; unrelated attachments and your edited notes are left alone.
Never publish a draft while its build is in progress. To abandon a version
before publishing, delete the draft and the tag, then release a new version.

Protect version tags against deletion/force updates and configure the
`github-release` environment with any required reviewers. Creating an
environment in YAML alone does not enable approval protection. Tags pushed with
the default `GITHUB_TOKEN` start no workflows, so **Tag Release** calls the
release workflow directly. No environment protection, tag rule, or remote
release is provisioned by editing these files locally.

Node is selected from `.node-version` (26). Rust is pinned in
`rust-toolchain.toml`; update the matching toolchain inputs in Actions together.
Actions are pinned to reviewed commit SHAs. Toolchain/action upgrades should pass
the same checks before merging.

Tailwind's core and Vite plugin are pinned together at 4.3.3, which uses the
Node 26-compatible module hooks. Upgrade them together and compare generated
styles; do not suppress Node deprecations globally. The complete HLS library is
loaded only on demand (native HLS remains preferred where supported). Its
~592 kB minified chunk has a 650 kB budget; every other JS chunk retains a 500 kB
budget. The Vite budget check fails the build if either grows beyond its limit
or HLS becomes a static/mixed chunk. Do not switch to `hls.js/light` just to fit
the generic warning threshold: it omits subtitle/audio/codec capabilities.

The JavaScript runtime bundled **inside an Action** is separate from the Node
version used by application commands. Our JavaScript Actions now use Node 24
while `npm`/build scripts use Node 26. Updating `setup-node`'s input alone cannot
fix an old Action's Node 20 deprecation warning. The macOS arm64 capacity notice
is GitHub runner scheduling, not a compiler warning; we keep the supported runner
and do not change architectures merely to hide that notice.

### Cross-platform workflow references and naming

Reviewed on 2026-10-11; these are patterns to learn from, not workflows to copy wholesale:

| Project | Relevant maintenance pattern | Decision for Kuriume |
| --- | --- | --- |
| [Readest](https://github.com/readest/readest/blob/main/.github/workflows/release.yml) | Tauri multi-platform matrix; signed macOS bundles, multiple desktop architectures and APKs | Reuse the matrix/platform-boundary approach; do not adopt its extra CEF, cloud storage or updater infrastructure |
| [Readest Nightly](https://github.com/readest/readest/blob/main/.github/workflows/nightly.yml) | Scheduled timestamped builds; per-platform metadata assembled before updating the nightly index | Main CI artifacts suffice for now; no extra nightly job or duplicated build recipes |
| [Artcraft](https://github.com/storytold/artcraft/blob/main/.github/workflows/artcraft-macos-publish.yml) | Universal Mac DMG/App archive, Developer ID + notarization; Windows EXE/MSI in a separate workflow | Adopt formats and optional signing, but target Apple Silicon only; keep one reusable build flow and all-platform publish gate |

Readest's [iOS distribution uses App Store/TestFlight lanes](https://github.com/readest/readest/blob/main/fastlane/Fastfile);
“supports all platforms” does not mean every platform can directly install a
GitHub Release asset. No current Linux package is advertised by Kuriume; adding
one also needs Linux-specific build/runtime/playback validation.

Common names refer to different layers:

- **Monorepo / shared codebase**: one repository, shared product version, thin
  platform-specific configuration/native adapters; not a branch per OS.
- **Matrix build**: expand the desktop build across OS/architecture combinations.
- **Reusable workflow** (`workflow_call`): reuse complete jobs between main and
  versioned releases. **Composite Action**: reuse a group of steps, such as our
  artifact staging/upload action.
- **Stable** (`vX.Y.Z`), **Beta/RC** (`vX.Y.Z-beta.N` / `-rc.N`) and
  **Nightly/Canary** (frequent development snapshots) are release-channel names,
  not installer types. We currently keep main test artifacts and versioned
  stable/prerelease releases; no scheduled Nightly/Canary or auto-update feed.
- **Universal / arm64 / x64** describe architectures; **DMG / MSI / APK / IPA**
  describe packaging. An **unsigned IPA** describes signing status, not a channel.

## Code Style

- **Frontend**: TypeScript strict mode. Use `cn()` to merge Tailwind classes.
- **Backend**: Zero `cargo clippy` warnings. Format with `cargo fmt`.
- Path alias `@/` maps to `src/`.

## License

All contributions are released under the [GPLv3](LICENSE) license.
