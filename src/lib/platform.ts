// Build-time platform identity is separate from responsive layout/input mode.
export const isMobileApp = ["ios", "android"].includes(import.meta.env.TAURI_ENV_PLATFORM ?? "");
export const isAndroidApp = import.meta.env.TAURI_ENV_PLATFORM === "android";
