import { isUpgrade, type UpdateCheck } from "@/lib/app-update";

/** The version this device ran last; what's new shows once after it changes. */
export const LAST_VERSION_KEY = "kuriume:last-version";
/** A release the user chose not to be reminded about again. */
export const SKIPPED_VERSION_KEY = "kuriume:update-skipped";
/** Written by use-app-update; builds before these prompts only left this behind. */
const UPDATE_CACHE_KEY = "kuriume:update-check";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export function readKey(storage: KeyValueStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeKey(storage: KeyValueStorage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch { /* per-device reminders only */ }
}

/**
 * The version that ran before this launch. Builds older than these prompts
 * never wrote it, but their update check cached the version it ran on.
 */
export function previousVersion(storage: KeyValueStorage | undefined): string | null {
  const last = readKey(storage, LAST_VERSION_KEY);
  if (last) return last;
  try {
    const cached = JSON.parse(readKey(storage, UPDATE_CACHE_KEY) ?? "null") as { result?: { current?: unknown } } | null;
    return typeof cached?.result?.current === "string" ? cached.result.current : null;
  } catch {
    return null;
  }
}

export type UpdatePromptKind = "whats-new" | "update" | null;

/**
 * At most one prompt per launch: what's new right after an upgrade, else a
 * newer release the user has not skipped.
 */
export function choosePrompt({ version, previous, update, skipped, notesPending }: {
  version: string | undefined;
  previous: string | null;
  update: UpdateCheck | undefined;
  skipped: string | null;
  notesPending: boolean;
}): UpdatePromptKind {
  if (!version) return null;
  if (isUpgrade(version, previous)) return notesPending ? null : "whats-new";
  if (update?.status === "available" && update.latest !== skipped) return "update";
  return null;
}
