import { invoke } from "@tauri-apps/api/core";
import { diagnose, diagnosticMessage } from "@/lib/diagnostics";

export interface PlayerLevels { volume: number; brightness: number }
export type MobileControl = "prepare" | "pause" | "levels" | "volume" | "brightness" | "finish" | "fullscreen" | "leave";
export function mobileControl(action: MobileControl, value?: number, session?: string) {
  return invoke<PlayerLevels>("plugin:mobile|control", { request: { action, value, session } }).catch((error: unknown) => {
    diagnose("native_control", "warn", { code: "native", action, message: diagnosticMessage(error) });
    throw error;
  });
}
