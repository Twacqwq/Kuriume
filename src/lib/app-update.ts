import { invoke } from "@tauri-apps/api/core";

/** The project's home. Rust only opens this page and paths below it. */
export const PROJECT_URL = "https://github.com/Twacqwq/Kuriume";
const RELEASES_API = "https://api.github.com/repos/Twacqwq/Kuriume/releases";
const LATEST_RELEASE_API = `${RELEASES_API}/latest`;

export type UpdateDownload = { name: string; url: string; size: number };
export type UpdateCheck =
  | { status: "latest"; current: string; latest: string | null }
  | {
      status: "available";
      current: string;
      latest: string;
      notes: string;
      pageUrl: string;
      publishedAt: string | null;
      /** The package for this platform, when the release has one. */
      download: UpdateDownload | null;
    };

type GithubRelease = {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
};

type Version = { core: [number, number, number]; pre: (string | number)[] };

function parseVersion(value: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  const pre = match[4] ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [];
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

/** Semantic-version order: 1 when `a` is newer, -1 when older, 0 when equal or unparsable. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index++) {
    if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1;
  }
  // A release outranks its own prereleases (1.0.0 > 1.0.0-beta.2).
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y ? 1 : -1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export type UpdatePlatform = "android" | "ios" | "macos" | "windows" | "other";

export function detectPlatform(userAgent: string): UpdatePlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/macintosh|mac os x/i.test(userAgent)) return "macos";
  if (/windows/i.test(userAgent)) return "windows";
  return "other";
}

/** Release package names come from scripts/package-artifacts.mjs. iOS builds are unsigned, so iOS gets the release page. */
const PACKAGE_SUFFIX: Partial<Record<UpdatePlatform, string>> = {
  android: "-android-arm64.apk",
  macos: "-macos-arm64.dmg",
  windows: "-windows-x64.exe",
};

export function pickDownload(release: Pick<GithubRelease, "assets">, platform: UpdatePlatform): UpdateDownload | null {
  const suffix = PACKAGE_SUFFIX[platform];
  const asset = suffix ? release.assets.find((item) => item.name.startsWith("Kuriume-") && item.name.endsWith(suffix)) : undefined;
  if (!asset || !asset.browser_download_url.startsWith(`${PROJECT_URL}/releases/download/`)) return null;
  return { name: asset.name, url: asset.browser_download_url, size: asset.size };
}

/**
 * Compares the running version with the newest published (non-prerelease)
 * GitHub release. Releases come from .github/workflows/release.yml.
 */
export async function checkForUpdate(
  current: string,
  platform: UpdatePlatform,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheck> {
  const response = await fetchImpl(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  // No published release yet.
  if (response.status === 404) return { status: "latest", current, latest: null };
  if (response.status === 403 || response.status === 429) throw new Error("GitHub rate limit reached; try again later");
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const release = (await response.json()) as GithubRelease;
  const latest = release.tag_name.replace(/^v/, "");
  if (release.draft || release.prerelease || compareVersions(latest, current) <= 0) {
    return { status: "latest", current, latest };
  }
  return {
    status: "available",
    current,
    latest,
    notes: release.body?.trim() ?? "",
    pageUrl: releasePage(release),
    publishedAt: release.published_at,
    download: pickDownload(release, platform),
  };
}

function releasePage(release: Pick<GithubRelease, "html_url">): string {
  return release.html_url.startsWith(`${PROJECT_URL}/`) ? release.html_url : `${PROJECT_URL}/releases`;
}

export type ReleaseNotes = { version: string; notes: string; pageUrl: string };

/** The published notes of one version (`v0.2.0`), or null when it has none. */
export async function fetchReleaseNotes(version: string, fetchImpl: typeof fetch = fetch): Promise<ReleaseNotes | null> {
  const response = await fetchImpl(`${RELEASES_API}/tags/v${encodeURIComponent(version)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;
  const release = (await response.json()) as GithubRelease;
  if (release.draft) return null;
  return { version, notes: release.body?.trim() ?? "", pageUrl: releasePage(release) };
}

/** True when this launch runs a newer version than the last one seen. */
export function isUpgrade(current: string, previous: string | null | undefined): boolean {
  return Boolean(previous) && compareVersions(current, previous!) > 0;
}

/**
 * Release notes are GitHub Markdown (release-please changelogs); show them as
 * short plain text without the version heading or commit/PR references.
 */
export function plainReleaseNotes(markdown: string, maxLines = 8): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+\[?v?\d+\.\d+\.\d+/.test(line))
    .map((line) => line
      // "([#12](…))", "([abc1234](…))": references, not content.
      .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "• ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim())
    .filter((line) => line && !/^full changelog/i.test(line))
    .slice(0, maxLines);
}

/** Opens a project page (or release download) in the system browser. */
export function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}
