// Draft release notes from the Conventional Commits since the previous tag:
// `node scripts/release-notes.mjs v0.3.0 > notes.md`. The draft is meant to be
// edited on the release page before publishing; the in-app update dialog shows
// it to users.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
/** User-facing sections, in order; other commit types are left out. */
const SECTIONS = [
  ["breaking", "⚠ BREAKING CHANGES"],
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance Improvements"],
];

export function parseCommit(subject, body = "") {
  const match = SUBJECT.exec(subject.trim());
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return { type: type.toLowerCase(), scope: scope ?? null, breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body), description };
}

/** Markdown for one release from `{ subject, body }` commits, newest first. */
export function releaseNotes(commits, { repo, previousTag, tag }) {
  if (!previousTag) {
    return `First release of Kuriume.\n\n**Full Changelog**: https://github.com/${repo}/commits/${tag}\n`;
  }
  const groups = new Map(SECTIONS.map(([key]) => [key, []]));
  const seen = new Set();
  for (const { subject, body } of commits) {
    const commit = parseCommit(subject, body);
    if (!commit) continue;
    const key = commit.breaking ? "breaking" : commit.type;
    const line = commit.scope ? `**${commit.scope}:** ${commit.description}` : commit.description;
    if (!groups.has(key) || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    groups.get(key).push(line);
  }
  const sections = SECTIONS
    .filter(([key]) => groups.get(key).length > 0)
    .map(([key, title]) => `### ${title}\n\n${groups.get(key).map((line) => `* ${line}`).join("\n")}`);
  const changes = sections.length > 0 ? sections.join("\n\n") : "No user-facing changes.";
  return `${changes}\n\n**Full Changelog**: https://github.com/${repo}/compare/${previousTag}...${tag}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: node scripts/release-notes.mjs <tag>");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  let previousTag = null;
  try {
    previousTag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${tag}^`);
  } catch { /* the first tag */ }
  const log = previousTag ? git("log", "--no-merges", "--format=%s%x1f%b%x1e", `${previousTag}..${tag}`) : "";
  const commits = log.split("\x1e").map((entry) => entry.trim()).filter(Boolean)
    .map((entry) => { const [subject, body = ""] = entry.split("\x1f"); return { subject, body }; });
  process.stdout.write(releaseNotes(commits, { repo: process.env.GITHUB_REPOSITORY || "Twacqwq/Kuriume", previousTag, tag }));
}
