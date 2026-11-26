import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronRight } from "lucide-react";
import * as React from "react";

export type Feedback = { kind: "success" | "error"; message: string };

/** A titled card of setting rows. */
export function SettingsGroup({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const id = `settings-${title}`;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex min-h-12 items-center justify-between gap-3 pl-1">
        <h2 id={id} className="text-sm font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
        {children}
      </div>
    </section>
  );
}

/** One label + control row. */
export function SettingRow({
  icon,
  label,
  htmlFor,
  stackOnMobile = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  htmlFor: string;
  stackOnMobile?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-20 items-center justify-between gap-3 px-4 py-3",
        stackOnMobile && "flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 text-muted-foreground [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]">
        {icon}
        <Label htmlFor={htmlFor} className="min-w-0 text-sm leading-snug text-foreground">{label}</Label>
      </div>
      {children}
    </div>
  );
}

const LINK_ROW_CLASS =
  "press flex min-h-16 items-center gap-3 px-4 py-3 text-sm font-medium outline-none hover:bg-secondary/60 active:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-readable [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]";

/** A row that opens another page; the target decides which search state it needs. */
export function LinkRow(props: {
  icon: React.ReactNode;
  label: string;
} & (
  | { to: "/watchlist"; search: { view: "history" } }
  | { to: "/settings/sync"; search?: never }
)) {
  const body = (
    <>
      <span className="text-muted-foreground">{props.icon}</span>
      <span className="flex-1">{props.label}</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </>
  );
  if (props.to === "/watchlist") {
    return (
      <Link to="/watchlist" search={props.search} className={LINK_ROW_CLASS}>
        {body}
      </Link>
    );
  }
  return (
    <Link to="/settings/sync" className={LINK_ROW_CLASS}>
      {body}
    </Link>
  );
}

export function SettingsFeedback({ feedback }: { feedback: Feedback }) {
  return (
    <p
      role={feedback.kind === "error" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-2 py-2 text-sm leading-relaxed",
        feedback.kind === "error"
          ? "text-destructive-readable"
          : "text-muted-foreground",
      )}
    >
      {feedback.kind === "error" ? (
        <AlertCircle aria-hidden="true" size={14} className="shrink-0" />
      ) : (
        <Check aria-hidden="true" size={14} className="shrink-0" />
      )}
      <span className="min-w-0 break-words">{feedback.message}</span>
    </p>
  );
}
