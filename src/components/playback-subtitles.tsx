import { useDisplayLanguage } from "@/hooks/use-display-language";
import type { PlaybackSubtitle } from "@/lib/playback";
import { preferredSubtitle, subtitleKey } from "@/lib/playback-selection";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlaybackSubtitles({ tracks, value, onChange, failed }: {
  tracks?: PlaybackSubtitle[];
  value: string;
  onChange: (value: string) => void;
  failed: boolean;
}) {
  const zh = useDisplayLanguage() === "zh";
  const chinese = preferredSubtitle(tracks);
  const missing = value === "auto" ? !chinese : value !== "off" && !tracks?.some((track) => subtitleKey(track) === value);
  const automaticLabel = chinese
    ? (zh ? "自动 · 中文优先" : "Auto · Chinese first")
    : (zh ? "自动 · 暂无中文" : "Auto · No Chinese track");
  return (
    <section>
      <label htmlFor="playback-subtitle" className="text-xs font-medium text-muted-foreground">{zh ? "字幕" : "Subtitles"}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="playback-subtitle" className="mt-3" aria-describedby={failed ? "subtitle-status" : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{automaticLabel}</SelectItem>
          <SelectItem value="off">{zh ? "关闭字幕" : "Off"}</SelectItem>
          {missing && value !== "auto" && <SelectItem value={value} disabled>{zh ? "所选字幕不可用" : "Selected track unavailable"}</SelectItem>}
          {!!tracks?.length && <SelectSeparator />}
          {tracks?.map((track) => <SelectItem key={track.url} value={subtitleKey(track)}>{track.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {failed && (
        <p id="subtitle-status" role="status" className="mt-2 text-xs text-destructive-readable">
          {zh ? "字幕加载失败，请重选字幕。" : "Subtitles failed to load. Select another track."}
        </p>
      )}
    </section>
  );
}
