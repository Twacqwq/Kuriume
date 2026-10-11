// SVG paths generated from the installed Lucide icons. Keep server rendering
// out of the playback bundle; ArtPlayer accepts SVG strings through its API.
const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
const play = svg('<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>');
const volume = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>';
const minimize = svg('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>');

export const playerIcons = {
  play,
  state: play,
  pause: svg('<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>'),
  volume: svg(`${volume}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`),
  volumeClose: svg(`${volume}<path d="m22 9-6 6m0-6 6 6"/>`),
  setting: svg('<path d="M14 17H5M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  fullscreenWebOn: svg('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8m-4-4v4"/>'),
  fullscreenWebOff: minimize,
  fullscreenOn: svg('<path d="m15 15 6 6m-6-12 6-6m0 13v5h-5m5-13V3h-5M3 16v5h5m-5 0 6-6M3 8V3h5m1 6L3 3"/>'),
  fullscreenOff: minimize,
  check: svg('<path d="m20 6-11 11-5-5"/>'),
  arrowLeft: svg('<path d="m15 18-6-6 6-6"/>'),
  arrowRight: svg('<path d="m9 18 6-6-6-6"/>'),
  playbackRate: svg('<path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0"/>'),
  aspectRatio: svg('<rect width="20" height="12" x="2" y="6" rx="2"/>'),
  loading: svg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),
  error: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>'),
};
