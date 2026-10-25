/** "hq": the large (VL) networks; "fast": the medium (M) ones for phones. */
export type Anime4KQuality = "hq" | "fast";

export type Size = { width: number; height: number };

/**
 * How many x2 upscale passes a source needs to fill the target, as in
 * Anime4K's Mode A: one when the target is >1.2x the source, a second when
 * it is >2.4x. Restore always runs.
 */
export function upscalePasses(native: Size, target: Size): 0 | 1 | 2 {
  const ratio = Math.min(target.width / native.width, target.height / native.height);
  if (!(ratio > 1.2)) return 0;
  return ratio > 2.4 ? 2 : 1;
}

/** How large Anime4K may draw: a pixel-ratio and an output-size ceiling. */
export type OutputLimits = { pixelRatio: number; width: number; height: number };

/**
 * 画质优先 (default): up to 2x device pixels and 4K. 流畅优先: CSS pixels and
 * 1080p at most, which also needs fewer x2 passes (the large GPU cost).
 */
export const OUTPUT_LIMITS = {
  quality: { pixelRatio: 2, width: 3840, height: 2160 },
  smooth: { pixelRatio: 1, width: 1920, height: 1080 },
} as const satisfies Record<string, OutputLimits>;

/** Canvas backing size: the displayed box in device pixels, within `limits`. */
export function targetSize(box: Size, native: Size, pixelRatio: number, limits: OutputLimits = OUTPUT_LIMITS.quality): Size {
  const scale = Math.min(box.width / native.width, box.height / native.height);
  const ratio = Math.min(pixelRatio, limits.pixelRatio);
  let width = Math.round(native.width * scale * ratio);
  let height = Math.round(native.height * scale * ratio);
  const cap = Math.min(1, limits.width / width, limits.height / height);
  width = Math.max(1, Math.round(width * cap));
  height = Math.max(1, Math.round(height * cap));
  return { width, height };
}
