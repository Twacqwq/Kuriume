import type { UpdateCheck } from "@/lib/app-update";

/** A release the user chose not to be reminded about again. */
export const SKIPPED_VERSION_KEY = "kuriume:update-skipped";

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

/** Remind about a newer release unless the user skipped that version. */
export function shouldPromptUpdate(update: UpdateCheck | undefined, skipped: string | null): boolean {
  return update?.status === "available" && update.latest !== skipped;
}
