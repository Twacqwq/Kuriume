import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" className={cn(
      "flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-secondary/40 px-3 text-sm outline-none transition-colors hover:border-border hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-primary-readable disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-primary-readable/60 [&>span:first-child]:truncate",
      className,
    )} {...props}>
      {children}
      <SelectPrimitive.Icon asChild><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content data-slot="select-content" position="popper" sideOffset={6} collisionPadding={12}
        className={cn("z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) min-w-0 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground", className)} {...props}>
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground"><ChevronUp size={14} /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="hide-scrollbar p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground"><ChevronDown size={14} /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cn(
      "relative flex min-h-9 cursor-default select-none items-center rounded-md py-2 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[state=checked]:bg-primary/14 data-[state=checked]:text-primary-readable [&>span:first-child]:min-w-0 [&>span:first-child]:break-words",
      className,
    )} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-3 flex size-4 items-center justify-center"><Check size={14} /></SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator(props: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className="my-1.5 h-px bg-border/70" {...props} />;
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectSeparator };
