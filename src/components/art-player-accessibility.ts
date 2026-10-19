import type Artplayer from "artplayer";
import { gestureTime } from "@/lib/player-gestures";

/** Add semantics without replacing ArtPlayer's controls or their pointer handlers. */
export function bindPlayerAccessibility(art: Artplayer, language: string) {
  const { $player, $progress, $setting, $state } = art.template;
  const label = (zh: string, en: string) => language === "zh" ? zh : en;
  const button = (element: HTMLElement | null | undefined, name: string) => {
    if (!element) return;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", name);
    element.tabIndex = 0;
  };
  // art.icons getters return new elements, not the icons already mounted.
  button($player.querySelector<HTMLElement>(".art-control-playAndPause .art-icon-play"), label("播放", "Play"));
  button($player.querySelector<HTMLElement>(".art-control-playAndPause .art-icon-pause"), label("暂停", "Pause"));
  button($player.querySelector<HTMLElement>(".art-control-volume .art-icon-volume"), label("静音", "Mute"));
  button($player.querySelector<HTMLElement>(".art-control-volume .art-icon-volumeClose"), label("取消静音", "Unmute"));
  button(art.controls.setting, label("播放设置", "Player settings"));
  button($state, label("播放", "Play"));
  $setting.setAttribute("role", "group");
  $setting.setAttribute("aria-label", label("播放设置", "Player settings"));
  $progress.setAttribute("role", "slider");
  $progress.setAttribute("aria-label", label("播放进度", "Playback position"));
  $progress.setAttribute("aria-valuemin", "0");
  $progress.tabIndex = 0;

  const updateProgress = () => {
    const duration = Number.isFinite(art.duration) ? Math.max(0, art.duration) : 0;
    const position = Number.isFinite(art.currentTime) ? Math.min(duration, Math.max(0, art.currentTime)) : 0;
    $progress.setAttribute("aria-valuemax", String(Math.floor(duration)));
    $progress.setAttribute("aria-valuenow", String(Math.floor(position)));
    $progress.setAttribute("aria-valuetext", `${gestureTime(position)} / ${gestureTime(duration)}`);
    $progress.setAttribute("aria-disabled", String(duration === 0));
    $state.tabIndex = $player.classList.contains("art-mask-show") && !art.loading.show ? 0 : -1;
  };
  const updateSettings = () => {
    art.controls.setting?.setAttribute("aria-expanded", String(art.setting.show));
    for (const item of $setting.querySelectorAll<HTMLElement>(".art-setting-item")) {
      item.setAttribute("role", "button");
      item.tabIndex = item.parentElement?.classList.contains("art-current") ? 0 : -1;
      if (item.dataset.value) item.setAttribute("aria-pressed", String(item.classList.contains("art-current")));
    }
  };
  // Settings sub-panels are created lazily by the library when opened.
  const observer = new MutationObserver(updateSettings);
  observer.observe($setting, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  updateProgress();
  updateSettings();
  art.on("video:timeupdate", updateProgress);
  art.on("video:loadedmetadata", updateProgress);
  art.on("video:playing", updateProgress);
  art.on("video:pause", updateProgress);
  art.on("mask", updateProgress);
  art.on("loading", updateProgress);
  art.on("setting", updateSettings);
  // Only keyboard focus reveals controls; a tapped control keeps DOM focus,
  // which must not pin the bottom bar open on touch screens.
  art.proxy($player, "focusin", (event) => {
    if ((event.target as Element | null)?.matches?.(":focus-visible")) art.controls.show = true;
  });
  // Pointer activation of the library's div control need not move DOM focus
  // into the player. Escape must also work when its target is still the body.
  art.proxy(document, "keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape" || !art.setting.show) return;
    event.preventDefault();
    event.stopPropagation();
    art.setting.show = false;
    art.controls.setting?.focus();
  });
  art.proxy($player, "keydown", (event) => {
    const key = event as KeyboardEvent;
    const target = event.target as HTMLElement;
    if (target === $progress && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key.key)) {
      key.preventDefault();
      key.stopPropagation();
      if (!Number.isFinite(art.duration) || art.duration <= 0) return;
      const next = key.key === "Home" ? 0 : key.key === "End" ? art.duration
        : art.currentTime + (["ArrowRight", "ArrowUp"].includes(key.key) ? 5 : -5);
      art.currentTime = Math.max(0, Math.min(art.duration, next));
      updateProgress();
      return;
    }
    const control = target.closest<HTMLElement>("button, [role=button]");
    if (!control || !["Enter", " "].includes(key.key)) return;
    // Prevent the document-level Space shortcut from also toggling playback.
    key.stopPropagation();
    if (control.tagName !== "BUTTON") {
      key.preventDefault();
      control.click();
      if ((control === art.controls.setting && art.setting.show) || control.closest(".art-settings")) {
        queueMicrotask(() => $setting.querySelector<HTMLElement>(".art-setting-panel.art-current .art-setting-item")?.focus());
      }
    }
  });
  return () => observer.disconnect();
}
