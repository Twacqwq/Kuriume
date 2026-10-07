import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-primary-readable focus-visible:ring-[3px] focus-visible:ring-primary-readable",
        "aria-invalid:border-destructive-readable aria-invalid:ring-destructive-readable/35",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
