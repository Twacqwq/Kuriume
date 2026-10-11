import { invoke } from "@tauri-apps/api/core";

export const diagnosticEvents = ["app_started", "ui_error", "catalog_request", "source_search", "source_episodes", "source_resolve", "source_prepare", "media_request", "player_load", "player_playing", "player_buffering", "player_seek", "player_error", "subtitle_error", "native_control", "player_fallback"] as const;
export const diagnosticCodes = ["start", "ok", "empty", "cancelled", "timeout", "connect", "http", "decode", "parse", "not_found", "source", "network", "unsupported", "aborted", "unknown", "type_error", "range_error", "reference_error", "syntax_error", "unhandled_rejection", "hls_manifest", "hls_fragment", "hls_buffer", "hls_key", "subtitle", "native"] as const;
export type DiagnosticEvent = typeof diagnosticEvents[number];
export type DiagnosticCode = typeof diagnosticCodes[number];
export type DiagnosticLevel = "info" | "warn" | "error";
export interface DiagnosticDetails {
  operation?: number;
  provider?: "anilist" | "anime1" | "xifan" | "agedm" | "hianime" | "imported";
  code?: DiagnosticCode;
  engine?: "hlsjs" | "native_hls" | "html_video";
  elapsedMs?: number;
  status?: number;
  count?: number;
  attempt?: number;
  position?: number;
  width?: number;
  height?: number;
  droppedFrames?: number;
  line?: number;
  column?: number;
  webviewMajor?: number;
}
interface DiagnosticInput { event: DiagnosticEvent; level: DiagnosticLevel; details: DiagnosticDetails }
export interface DiagnosticEntry extends DiagnosticInput { id: number; at: number; lastAt: number; repeats: number }
export interface DiagnosticPage {
  entries: DiagnosticEntry[];
  hasMore: boolean;
  bytes: number;
  maxBytes: number;
  total: number;
  evicted: number;
  version: string;
  platform: string;
}

// One shared buffer lives in Rust. Only 32 queued + 8 in-flight records here,
// even if the bridge stalls. No console interception, persistence or upload.
const pending: DiagnosticInput[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let clearing = false;

export function diagnose(event: DiagnosticEvent, level: DiagnosticLevel, details: DiagnosticDetails = {}) {
  if (!diagnosticEvents.includes(event) || !["info", "warn", "error"].includes(level)) return;
  // Runtime allowlist too: an accidental spread of a raw error cannot leak it.
  const safe: DiagnosticDetails = {};
  for (const key of ["operation", "elapsedMs", "status", "count", "attempt", "position", "width", "height", "droppedFrames", "line", "column", "webviewMajor"] as const) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      safe[key] = Math.min(Math.trunc(value), key === "status" ? 65_535 : 4_294_967_295);
    }
  }
  if (details.code && diagnosticCodes.includes(details.code)) safe.code = details.code;
  if (details.provider && ["anilist", "anime1", "xifan", "agedm", "hianime", "imported"].includes(details.provider)) safe.provider = details.provider;
  if (details.engine && ["hlsjs", "native_hls", "html_video"].includes(details.engine)) safe.engine = details.engine;
  if (pending.length === 32) pending.shift();
  pending.push({ event, level, details: safe });
  schedule();
}

function schedule() {
  if (!timer && !inFlight && !clearing && pending.length) timer = setTimeout(flush, 250);
}

function flush() {
  timer = undefined;
  if (inFlight || clearing || !pending.length) return;
  inFlight = invoke<void>("diagnostics_write", { entries: pending.splice(0, 8) })
    .catch(() => { /* Diagnostics must not trigger more diagnostics. */ })
    .finally(() => { inFlight = undefined; schedule(); });
}

export function readDiagnostics(before?: number, errorsOnly = false) {
  return invoke<DiagnosticPage>("diagnostics_read", { before: before ?? null, errorsOnly });
}

export async function clearDiagnostics() {
  if (clearing) return;
  clearing = true;
  clearTimeout(timer);
  timer = undefined;
  pending.length = 0;
  try {
    // Drain the sole in-flight write before clearing so old entries cannot
    // reappear. Events produced during clear remain bounded in the queue.
    await inFlight;
    await invoke("diagnostics_clear");
  } finally {
    clearing = false;
    schedule();
  }
}

export function installErrorDiagnostics() {
  const errorCode = (reason: unknown): DiagnosticCode => {
    if (!(reason instanceof Error)) return "unknown";
    switch (reason.name) {
      case "TypeError": return "type_error";
      case "RangeError": return "range_error";
      case "ReferenceError": return "reference_error";
      case "SyntaxError": return "syntax_error";
      default: return "unknown";
    }
  };
  const onError = (event: ErrorEvent) => diagnose("ui_error", "error", { code: errorCode(event.error), line: event.lineno, column: event.colno });
  const onRejection = (event: PromiseRejectionEvent) => diagnose("ui_error", "error", { code: errorCode(event.reason) === "unknown" ? "unhandled_rejection" : errorCode(event.reason) });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const major = navigator.userAgent.match(/(?:Chrome|Version)\/(\d+)/)?.[1];
  diagnose("app_started", "info", { webviewMajor: major ? Number(major) : undefined });
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    clearTimeout(timer);
    timer = undefined;
    pending.length = 0;
  };
}

export function diagnosticReport(page: DiagnosticPage) {
  return `Kuriume ${page.version} / ${page.platform}\n${page.entries.length} entries on this page; ${page.total} retained; ${page.evicted} evicted\n\n${page.entries.map((entry) => {
    const details = Object.fromEntries(Object.entries(entry.details).filter(([, value]) => value != null));
    return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.event} ×${entry.repeats} ${JSON.stringify(details)}`;
  }).join("\n")}`;
}
