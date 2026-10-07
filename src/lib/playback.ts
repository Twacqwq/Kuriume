export interface PlaybackSubtitle {
  label: string;
  url: string;
  language?: string;
}

export interface DirectMediaAsset {
  kind: "direct";
  url: string;
  mimeType?: "application/x-mpegURL" | "application/vnd.apple.mpegurl" | "video/mp4" | "video/webm";
  subtitles?: PlaybackSubtitle[];
}

export type PlayableAsset = DirectMediaAsset;

export interface PlayableSource {
  name: string;
  asset: PlayableAsset;
}
