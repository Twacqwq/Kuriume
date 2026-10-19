import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDisplayLanguage } from "@/hooks/use-display-language";
import { SearchSuggestions, rememberSearch } from "@/components/search-suggestions";
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
      if (query.trim()) submit(query);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  function submit(value: string) {
    rememberSearch(value);
    onClose();
    navigate({ to: "/search", search: { q: value.trim() } });
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="search-panel flex max-h-[min(36rem,72vh)] translate-y-0 flex-col gap-0 rounded-xl bg-card p-2 sm:top-[14vh] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:rounded-none max-sm:border-0 max-sm:bg-background" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>
        <DialogTitle className="sr-only">{language === "zh" ? "搜索动画" : "Search anime"}</DialogTitle>
        <form className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl pl-3 max-sm:bg-card" onSubmit={(event) => { event.preventDefault(); if (!composing.current && !suppressImeSubmit.current && query.trim()) { submit(query); } }}>
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
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button type="button" onClick={onClose} aria-label={language === "zh" ? "关闭搜索" : "Close search"} className="grid size-12 shrink-0 place-items-center rounded-lg text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary-readable"><X size={19} /></button>
        </form>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SearchSuggestions query={query} onSearch={(value) => submit(value)} onNavigate={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
