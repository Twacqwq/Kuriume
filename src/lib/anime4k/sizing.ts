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

/** Canvas backing size: the displayed box in device pixels, capped at 4K. */
export function targetSize(box: Size, native: Size, pixelRatio: number): Size {
  const scale = Math.min(box.width / native.width, box.height / native.height);
  let width = Math.round(native.width * scale * pixelRatio);
  let height = Math.round(native.height * scale * pixelRatio);
  const cap = Math.min(1, 3840 / width, 2160 / height);
  width = Math.max(1, Math.round(width * cap));
  height = Math.max(1, Math.round(height * cap));
  return { width, height };
}
