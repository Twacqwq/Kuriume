// Build-time platform identity is separate from responsive layout/input mode.
export const isMobileApp = ["ios", "android"].includes(import.meta.env.TAURI_ENV_PLATFORM ?? "");
export const isAndroidApp = import.meta.env.TAURI_ENV_PLATFORM === "android";
export const isIosApp = import.meta.env.TAURI_ENV_PLATFORM === "ios";
export const isMacApp = import.meta.env.TAURI_ENV_PLATFORM === "darwin";

/** Records transfer and WebDAV sync stay hidden on macOS and iOS for now. */
export const recordsFeaturesHidden = isMacApp || isIosApp;
