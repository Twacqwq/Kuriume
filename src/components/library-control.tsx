import { DropdownMenu } from "radix-ui";
import { Bookmark, Check, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { LIBRARY_STATUSES, type LibraryEntry, type LibraryStatus } from "@/lib/store";
import { cn } from "@/lib/utils";

export function LibraryControl({
  entry,
  onSetStatus,
  onRemove,
  compact = false,
  disabled = false,
}: {
  entry: LibraryEntry | null;
  onSetStatus: (status: LibraryStatus) => void;
  onRemove: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const language = useDisplayLanguage();
  const size = compact ? "sm" : "lg";
  if (!entry) {
    return (
      <Button variant="secondary" size={size} className="rounded-full" disabled={disabled}
        onClick={() => onSetStatus("following")}>
        <Bookmark size={16} />
        {language === "zh" ? "追番" : "Follow"}
      </Button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size={size} disabled={disabled}
          className={cn("rounded-full", !compact && "text-primary-readable")}
          aria-label={language === "zh" ? "修改追番状态" : "Change library status"}>
          {!compact && <Check size={16} />}
          {LIBRARY_STATUSES.find((item) => item.id === entry.status)![language]}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12}
          className="z-50 w-48 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground outline-none">
          <DropdownMenu.RadioGroup value={entry.status} onValueChange={(value) => {
            if (value !== entry.status) onSetStatus(value as LibraryStatus);
          }}>
            {LIBRARY_STATUSES.map((status) => (
              <DropdownMenu.RadioItem key={status.id} value={status.id}
                className="flex min-h-10 cursor-default select-none items-center gap-2.5 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-accent data-[state=checked]:text-primary-readable">
                {status.id === "completed" ? <Check size={16} /> : <Bookmark size={16} />}
                {status[language]}
                <DropdownMenu.ItemIndicator className="ml-auto"><Check size={14} /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1.5 h-px bg-border/70" />
          <DropdownMenu.Item onSelect={onRemove}
            className="flex min-h-10 cursor-default select-none items-center gap-2.5 rounded-lg px-3 text-sm text-destructive-readable outline-none data-[highlighted]:bg-destructive/10">
            <Trash2 size={16} />
            {language === "zh" ? "从资料库移除" : "Remove from library"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
