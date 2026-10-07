import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { useEffect, useRef, useState } from "react";

interface SearchPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SearchPanel({ open, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const suppressImeSubmit = useRef(false);
  const navigate = useNavigate();
  const language = useDisplayLanguage();

  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter confirms an IME candidate before it submits a search. Safari can
    // report isComposing=false on that keydown, but still uses keyCode 229.
    if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
      // Some mobile keyboards also dispatch a form submit for this same key.
      // Do not preventDefault here: that can stop the IME confirming its text.
      suppressImeSubmit.current = true;
      setTimeout(() => { suppressImeSubmit.current = false; }, 0);
      return;
    }
    suppressImeSubmit.current = false;
    if (e.key === "Enter") {
      e.preventDefault();
      if (query.trim()) {
        onClose();
        navigate({ to: "/search", search: { q: query.trim() } });
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-[max(1rem,env(safe-area-inset-top))] translate-y-0 gap-0 rounded-xl bg-card p-2 sm:top-[18vh]" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>
        <DialogTitle className="sr-only">{language === "zh" ? "搜索动画" : "Search anime"}</DialogTitle>
        <form className="flex min-w-0 items-center gap-3 pl-3" onSubmit={(event) => { event.preventDefault(); if (!composing.current && !suppressImeSubmit.current && query.trim()) { onClose(); void navigate({ to: "/search", search: { q: query.trim() } }); } }}>
          <Search size={18} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            placeholder={language === "zh" ? "搜索动画" : "Search anime"}
            aria-label={language === "zh" ? "搜索动画" : "Search anime"}
            enterKeyHint="search"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button type="button" onClick={onClose} aria-label={language === "zh" ? "关闭搜索" : "Close search"} className="grid size-12 shrink-0 place-items-center rounded-lg text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary-readable"><X size={19} /></button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
