import {
  onlineSourceApi,
  type PlaybackResolveRequest,
} from "@/lib/online-source";
import type { PlayableAsset, PlayableSource } from "@/lib/playback";
import { nextPlaybackSource } from "@/lib/playback-selection";
import { useCallback, useEffect, useRef, useState } from "react";

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
      return { ...current, selectedIndex, phase: "ready", error: null, failedNames: [] };
    });
  }, []);

  const reportError = useCallback((asset: PlayableAsset, message: string) => {
    setState((current) => {
      const selected = current.sources[current.selectedIndex];
      // Late events from a disposed player must not fail the next episode/line.
      if (current.phase !== "ready" || selected?.asset !== asset) return current;
      const failedNames = [...current.failedNames, selected.name];
      const next = nextPlaybackSource(current.sources, failedNames);
      return next >= 0
        ? { ...current, selectedIndex: next, failedNames, error: null }
        : { ...current, phase: "error", failedNames, error: message };
    });
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  const selectedSource = state.sources[state.selectedIndex];
  return { ...state, asset: state.phase === "ready" ? selectedSource?.asset ?? null : null,
    selectedSource, resolve, selectSource, reportError, reset };
}
