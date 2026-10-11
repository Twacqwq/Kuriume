// Maintainer-only snapshot update; app startup and builds never download aliases.
import { mkdir, writeFile } from "node:fs/promises";

const revision = process.argv[2] ?? "db6eff10d13d025205abf2fc7dc8fc9ac59c8772";
if (!/^[a-f0-9]{40}$/.test(revision)) {
  throw new Error("Pass an immutable soruly/anilist-chinese commit SHA.");
}
const source = "https://github.com/soruly/anilist-chinese";
const base = `https://raw.githubusercontent.com/soruly/anilist-chinese/${revision}/`;
async function download(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}
const [data, license] = await Promise.all([
  download("anilist-chinese.json"), download("LICENSE"),
]);
const seen = new Set();
const entries = JSON.parse(data).map(({ id, title, synonyms }) => {
  if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)
    || typeof title !== "string" || !Array.isArray(synonyms)
    || synonyms.some((alias) => typeof alias !== "string")) {
    throw new Error("Unexpected upstream alias data; snapshot was not replaced.");
  }
  seen.add(id);
  const aliases = [...new Set([title, ...synonyms].map((alias) => alias.trim()).filter(Boolean))];
  if (!aliases.length) throw new Error(`Missing aliases for ${id}`);
  return [id, aliases];
}).sort((a, b) => a[0] - b[0]);
if (entries.length < 1000 || !license.startsWith("MIT License") || !license.includes("soruly")) {
  throw new Error("Unexpected upstream dataset or license; review before updating.");
}
const directory = new URL("../src-tauri/crates/kuriume-provider/data/", import.meta.url);
await mkdir(directory, { recursive: true });
// Keep the original copyright and permission notice inside the bundled snapshot.
const metadata = JSON.stringify({ source, revision, license }, null, 2).slice(0, -2);
await writeFile(new URL("anilist-chinese.json", directory),
  `${metadata},\n  "entries": [\n${entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]\n}\n`);
console.log(`Updated ${entries.length} AniList alias entries at ${revision}`);
