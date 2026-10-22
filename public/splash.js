// Launch splash: a random wallpaper on every start, never the same one twice
// in a row. A plain file rather than inline script in index.html (see the
// note in splash.css). Add a wallpaper by putting it in public/splash/ and
// listing it here.
(function () {
  var WALLPAPERS = ["/splash/1.webp"];
  var LAST_KEY = "kuriume:splash-last";
  var splash = document.getElementById("splash");
  if (!splash || WALLPAPERS.length === 0) return;

  var last = -1;
  try {
    var saved = localStorage.getItem(LAST_KEY);
    if (saved !== null) last = Number(saved);
  } catch (error) { /* storage unavailable */ }
  var count = WALLPAPERS.length;
  var index = count > 1 && last >= 0 && last < count
    ? (last + 1 + Math.floor(Math.random() * (count - 1))) % count
    : Math.floor(Math.random() * count);
  try { localStorage.setItem(LAST_KEY, String(index)); } catch (error) { /* storage unavailable */ }

  // Until the picture has decoded the splash keeps its plain colour; then it
  // fades in, so a slow first read never shows a half-drawn image.
  var art = splash.querySelector(".sp-art");
  var backdrop = splash.querySelector(".sp-backdrop");
  if (!art || !backdrop) return;
  art.onload = function () { splash.classList.add("sp-ready"); };
  art.src = WALLPAPERS[index];
  backdrop.src = WALLPAPERS[index];
})();
