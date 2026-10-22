import {
  onlineSourceApi,
  type PlaybackResolveRequest,
} from "@/lib/online-source";
import type { PlayableAsset, PlayableSource } from "@/lib/playback";
import { nextPlaybackSource } from "@/lib/playback-selection";
import { useCallback, useEffect, useRef, useState } from "react";
import { diagnose } from "@/lib/diagnostics";

export type ResolverPhase = "idle" | "resolving" | "ready" | "error";

interface ResolverState {
  requestKey: string | null;
  phase: ResolverPhase;
  sources: PlayableSource[];
  selectedIndex: number;
  failedNames: string[];
  error: string | null;
}

const INITIAL_STATE: ResolverState = {
  requestKey: null,
  phase: "idle",
  sources: [],
  selectedIndex: 0,
  failedNames: [],
  error: null,
};

export function playbackRequestKey(providerId: string, request: PlaybackResolveRequest) {
  return JSON.stringify([providerId, request.candidateId, request.roadId, request.episodeId]);
}

export function usePlaybackResolver() {
  const [state, setState] = useState<ResolverState>(INITIAL_STATE);
  const requestIdRef = useRef(0);
  const preferredRef = useRef<{ providerId: string; name: string } | null>(null);
  const providerRef = useRef("");

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const resolve = useCallback(async (providerId: string, request: PlaybackResolveRequest) => {
    const requestId = ++requestIdRef.current;
    const requestKey = playbackRequestKey(providerId, request);
    providerRef.current = providerId;
    setState({ ...INITIAL_STATE, phase: "resolving", requestKey });
    try {
      const sources = await onlineSourceApi.resolve(providerId, request);
      if (!sources.length) throw new Error("No playable sources for this episode");
      if (requestId === requestIdRef.current) {
        const preferred = preferredRef.current;
        const selectedIndex = preferred?.providerId === providerId
          ? Math.max(0, sources.findIndex((source) => source.name === preferred.name)) : 0;
        setState({ ...INITIAL_STATE, phase: "ready", sources, selectedIndex, requestKey });
      }
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setState({
          phase: "error",
          requestKey,
          sources: [],
          selectedIndex: 0,
          failedNames: [],
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
  }, []);

  const selectSource = useCallback((name: string) => {
    preferredRef.current = { providerId: providerRef.current, name };
    setState((current) => {
      const selectedIndex = current.sources.findIndex((source) => source.name === name);
      if (selectedIndex < 0) return current;
      // Failed marks stay, so the picker keeps showing what already failed.
      return { ...current, selectedIndex, phase: "ready", error: null };
    });
  }, []);

  // A failing stream stops here and the viewer picks what to try next. Moving
  // on automatically raced the old stream, which sometimes started after all
  // and kept playing unseen behind the next attempt.
  const reportError = useCallback((asset: PlayableAsset, message: string) => {
    setState((current) => {
      const selected = current.sources[current.selectedIndex];
      // Late events from a disposed player must not fail the next episode/line.
      if (current.phase !== "ready" || selected?.asset !== asset) return current;
      const failedNames = current.failedNames.includes(selected.name) ? current.failedNames : [...current.failedNames, selected.name];
      return { ...current, phase: "error", failedNames, error: message };
    });
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  const selectedSource = state.sources[state.selectedIndex];
  const untried = state.phase === "error" ? nextPlaybackSource(state.sources, state.failedNames) : -1;
  /** Another stream of the same episode that has not failed yet, if any. */
  const nextStream = untried >= 0 ? state.sources[untried].name : null;
  const diagnosticId = selectedSource?.asset.diagnosticId;
  useEffect(() => {
    if (state.phase === "ready" && state.failedNames.length > 0) {
      diagnose("player_fallback", "info", { operation: diagnosticId, attempt: state.failedNames.length });
    }
  }, [diagnosticId, state.phase, state.selectedIndex, state.failedNames.length]);
  return { ...state, asset: state.phase === "ready" ? selectedSource?.asset ?? null : null,
    selectedSource, nextStream, resolve, selectSource, reportError, reset };
}
