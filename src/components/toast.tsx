import { cn } from "@/lib/utils";
import { AlertCircle, Check, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number>();

function emit() {
  for (const listener of listeners) listener();
}

function removeToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function dismissToast(id: number) {
  removeToast(id);
}

/**
 * Show a transient result at the top of the screen. The title is the
 * one-line result; the optional message carries counts or the server reason.
 */
export function showToast(kind: ToastKind, title: string, message?: string, duration?: number) {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts.slice(-2), { id, kind, title, message }];
  emit();
  const ttl = duration ?? (kind === "error" ? 7000 : 4500);
  timers.set(id, window.setTimeout(() => removeToast(id), ttl));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

export function ToastViewport() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (visible.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[calc(1rem+env(safe-area-inset-top))] z-[100] flex flex-col items-center gap-2 px-4 md:top-6">
      {[...visible].reverse().map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border bg-popover px-3.5 py-3 text-popover-foreground shadow-lg duration-200 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none",
            toast.kind === "error" ? "border-destructive-readable/40" : "border-border",
          )}
        >
          {toast.kind === "error" ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive-readable" aria-hidden="true" />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-primary-readable" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{toast.title}</p>
            {toast.message && <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{toast.message}</p>}
          </div>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => dismissToast(toast.id)}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary-readable focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
