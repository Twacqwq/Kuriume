/**
 * Hook for sniffing video URLs from online anime streaming sites.
 *
 * Uses a hidden Tauri WebView to load an episode page, hook XHR/fetch,
 * and extract the m3u8/mp4 video URL. The discovered URL is then passed
 * to the mpv player for native playback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { onlineSourceApi } from "@/lib/online-source";

// ── Types ────────────────────────────────────────────────────────

export type SnifferPhase =
  | "idle"
  | "sniffing"
  | "ready"
  | "error";

export interface SnifferState {
  phase: SnifferPhase;
  videoUrl: string | null;
  error: string | null;
}

const INITIAL_STATE: SnifferState = {
  phase: "idle",
  videoUrl: null,
  error: null,
};

// ── Hook ─────────────────────────────────────────────────────────

export function useVideoSniffer() {
  const [state, setState] = useState<SnifferState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  // Track in-flight sniff to prevent duplicate concurrent calls
  // (e.g. React StrictMode double-mount).
  const sniffingUrlRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const set = (patch: Partial<SnifferState>) => {
    if (mountedRef.current) setState((s) => ({ ...s, ...patch }));
  };

  /** Start sniffing a video URL from the given episode page. */
  const sniff = useCallback(async (episodeUrl: string) => {
    // Deduplicate: if already sniffing the same URL, skip the duplicate call.
    if (sniffingUrlRef.current === episodeUrl) return;
    sniffingUrlRef.current = episodeUrl;

    set({ phase: "sniffing", videoUrl: null, error: null });

    try {
      const url = await onlineSourceApi.sniffVideoUrl(episodeUrl);
      if (mountedRef.current) {
        set({ phase: "ready", videoUrl: url });
      }
    } catch (e) {
      if (mountedRef.current) {
        set({
          phase: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      sniffingUrlRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reset state back to idle. */
  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    ...state,
    sniff,
    reset,
  };
}
