/** Shortest time the launch splash stays, so the mascot can land. */
export const SPLASH_MIN_MS = 1500;
/** Never hold the app back longer than this for slow first data. */
export const SPLASH_MAX_MS = 3000;
const FADE_MS = 450;

/**
 * Fades out the inline launch splash from index.html once `ready` settles,
 * no earlier than SPLASH_MIN_MS after launch and no later than SPLASH_MAX_MS.
 */
export function dismissSplash(ready: Promise<unknown>, doc: Document = document, now = () => performance.now()) {
  const splash = doc.getElementById("splash");
  if (!splash) return Promise.resolve();
  const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const minimum = reduced ? 300 : SPLASH_MIN_MS;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const settled = ready.then(() => undefined, () => undefined);
  return Promise.race([settled, wait(SPLASH_MAX_MS - now())])
    .then(() => wait(minimum - now()))
    .then(() => {
      splash.classList.add("sp-out");
      return wait(FADE_MS);
    })
    .then(() => splash.remove());
}
