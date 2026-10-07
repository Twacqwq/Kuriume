/* Installed in every frame of an isolated, hidden resolver WebView. */
(() => {
  const seen = new Set();
  const marker = "kuriume-media-candidate";
  const isManifest = (url) => /\.m3u8(?:[?#]|$)/i.test(url);
  const isMedia = (url) => /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url);

  function report(raw, detected = false) {
    let url;
    try { url = new URL(raw, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || (!detected && !isMedia(url.href))
      || seen.has(url.href) || seen.size >= 16) return;
    seen.add(url.href);
    if (window === window.top) document.title = `__KURIUME_MEDIA__:${url.href}`;
    else window.top.postMessage({ type: marker, url: url.href, detected }, "*");
  }

  if (window === window.top) {
    window.addEventListener("message", (event) => {
      if (event.data?.type === marker && typeof event.data.url === "string") report(event.data.url, event.data.detected === true);
    });
  }

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    this.addEventListener("load", () => {
      if (this.status < 200 || this.status >= 300) return;
      let manifest = /mpegurl/i.test(this.getResponseHeader("content-type") || "");
      try { manifest ||= this.responseText.startsWith("#EXTM3U"); } catch { /* Binary response. */ }
      if (manifest || isManifest(this.responseURL)) report(this.responseURL, manifest);
    }, { once: true });
    return open.apply(this, arguments);
  };
  const fetch = window.fetch;
  window.fetch = function () {
    const promise = fetch.apply(this, arguments);
    promise.then((response) => {
      if (!response.ok) return;
      const manifest = /mpegurl/i.test(response.headers?.get("content-type") || "");
      if (manifest || isManifest(response.url)) report(response.url, manifest);
    }).catch(() => {});
    return promise;
  };

  // Native-HLS pages do not necessarily use fetch/XHR. A manifest supplied to
  // Hls is a candidate only; native code still verifies its response bytes.
  function hookHls(Hls) {
    if (!Hls?.prototype?.loadSource || Hls.prototype.__kuriumeHooked) return;
    Hls.prototype.__kuriumeHooked = true;
    const load = Hls.prototype.loadSource;
    Hls.prototype.loadSource = function (url) {
      report(url, true);
      return load.apply(this, arguments);
    };
  }
  let Hls = window.Hls;
  hookHls(Hls);
  try {
    Object.defineProperty(window, "Hls", {
      configurable: true, get: () => Hls, set: (value) => { Hls = value; hookHls(value); },
    });
  } catch { /* Non-configurable libraries are covered by network observation. */ }

  function inspect(video) {
    if (video.__kuriumeWatched) return;
    video.__kuriumeWatched = true;
    const capture = () => {
      // Ignore short pre-rolls and incomplete sources; never return a blob URL.
      if (video.duration > 60) report(video.currentSrc || video.src, true);
    };
    video.addEventListener("loadedmetadata", capture);
    capture();
    if (isManifest(video.src)) report(video.src);
  }
  function scan() {
    document.querySelectorAll("video").forEach(inspect);
    performance.getEntriesByType("resource").forEach((entry) => {
      if (isManifest(entry.name)) report(entry.name);
    });
  }
  function start() {
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
