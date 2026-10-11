import { invoke } from "@tauri-apps/api/core";

export const diagnosticEvents = ["app_started", "ui_error", "catalog_request", "source_search", "source_episodes", "source_resolve", "source_prepare", "media_request", "player_load", "player_playing", "player_play", "player_pause", "player_background", "player_buffering", "player_seek", "player_error", "subtitle_error", "native_control", "player_fallback"] as const;
export const diagnosticCodes = ["start", "ok", "empty", "cancelled", "timeout", "connect", "http", "decode", "parse", "not_found", "source", "network", "unsupported", "aborted", "unknown", "type_error", "range_error", "reference_error", "syntax_error", "unhandled_rejection", "hls_manifest", "hls_fragment", "hls_buffer", "hls_key", "subtitle", "native"] as const;
export const diagnosticActions = ["list", "search", "detail", "episodes", "calendar", "characters", "direct", "sniff", "fetch", "read", "redirect", "playlist", "prepare", "pause", "levels", "volume", "brightness", "finish", "fullscreen", "leave"] as const;
export type DiagnosticEvent = typeof diagnosticEvents[number];
export type DiagnosticCode = typeof diagnosticCodes[number];
export type DiagnosticLevel = "info" | "warn" | "error";
export interface DiagnosticDetails {
  operation?: number;
  provider?: "anilist" | "anime1" | "xifan" | "agedm" | "hianime" | "imported";
  code?: DiagnosticCode;
  action?: typeof diagnosticActions[number];
  message?: string;
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

// Match the Rust redactor: no URLs, credentials, local paths or opaque tokens.
// Sanitize before enqueueing too, so pending IPC cannot retain raw error text.
export function diagnosticMessage(reason: unknown): string {
  const parts: string[] = [];
  for (let depth = 0; depth < 4 && reason != null; depth++) {
    const text = (reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason === "string" ? reason : "Unknown error").slice(0, 2048)
      .replace(/(?:authorization|proxy-authorization|set-cookie|cookie|[a-z_]*(?:token|password|secret)|api[-_]?key)\s*["']?\s*[:=][^\r\n]*/gi, "[redacted]")
      .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, "[redacted]")
      .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/gi, "[redacted]")
      .replace(/(?:[A-Za-z]:\\|\/)[^\s<>"']+/g, "[redacted]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]")
      .replace(/[A-Za-z0-9_+=.-]{40,}/g, "[redacted]")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
    if (!parts.some(part => part.includes(text))) parts.push(text);
    reason = reason instanceof Error && "cause" in reason ? reason.cause : undefined;
  }
  // UTF-8 cap, without splitting multibyte characters.
  let size = 0, result = "";
  const encoder = new TextEncoder();
  for (const char of parts.join("; caused by: ")) {
    size += encoder.encode(char).length;
    if (size > 1024) break;
    result += char;
  }
  return result;
}

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
  if (details.action && diagnosticActions.includes(details.action)) safe.action = details.action;
  if (typeof details.message === "string") safe.message = diagnosticMessage(details.message);
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
  const onError = (event: ErrorEvent) => diagnose("ui_error", "error", { code: errorCode(event.error), message: diagnosticMessage(event.error ?? event.message), line: event.lineno, column: event.colno });
  const onRejection = (event: PromiseRejectionEvent) => diagnose("ui_error", "error", { code: errorCode(event.reason) === "unknown" ? "unhandled_rejection" : errorCode(event.reason), message: diagnosticMessage(event.reason) });
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

const codeMessages: Record<DiagnosticCode, string> = {
  start: "Started", ok: "Completed", empty: "No playable results", cancelled: "Cancelled", timeout: "Operation timed out", connect: "Connection failed", http: "HTTP request failed",
  decode: "Decode failed", parse: "Response parsing failed", not_found: "Resource not found", source: "Provider failed", network: "Network request failed", unsupported: "Unsupported media or engine", aborted: "Media request aborted",
  unknown: "Unknown error", type_error: "TypeError", range_error: "RangeError", reference_error: "ReferenceError", syntax_error: "SyntaxError", unhandled_rejection: "Unhandled promise rejection",
  hls_manifest: "HLS manifest failed", hls_fragment: "HLS segment failed", hls_buffer: "HLS buffer failed", hls_key: "HLS key failed", subtitle: "Subtitle failed", native: "Native control failed",
};

export function diagnosticText(entry: DiagnosticEntry) {
  const { provider, action, operation, message, code, status, ...metrics } = entry.details;
  const context = [provider, entry.event, action].filter(Boolean).join("/");
  const detail = message || (code ? codeMessages[code] : "");
  const values = Object.entries(metrics).filter(([, value]) => value != null).map(([key, value]) => `${key}=${value}`);
  return `[${context}]${operation != null ? ` #${operation}` : ""}${status ? ` HTTP ${status}` : ""}${detail ? ` — ${detail}` : ""}${code ? ` (${code})` : ""}${values.length ? ` ${values.join(" ")}` : ""}${entry.repeats > 1 ? ` ×${entry.repeats} last=${new Date(entry.lastAt).toISOString()}` : ""}`;
}

export function diagnosticReport(page: DiagnosticPage) {
  return `Kuriume ${page.version} / ${page.platform}\n${page.entries.length} entries on this page; ${page.total} retained; ${page.evicted} evicted\n\n${[...page.entries].reverse().map(entry =>
    `${new Date(entry.at).toISOString()} [${entry.level.toUpperCase()}] ${diagnosticText(entry)}`
  ).join("\n")}`;
}
