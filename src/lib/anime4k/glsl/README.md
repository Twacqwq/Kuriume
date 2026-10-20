# Anime4K GLSL (WebGL2 fallback)

`Anime4K_Restore_CNN_M.glsl` and `Anime4K_Upscale_CNN_x2_M.glsl` are copied
unchanged from [bloc97/Anime4K](https://github.com/bloc97/Anime4K) (MIT, see
`LICENSE`), commit `7684e9586f8dcc738af08a1cdceb024cc184f426`.

They are mpv user shaders; `mpv-hook.ts` reads their `//!` directives and
wraps each pass for WebGL2, and `../webgl-renderer.ts` runs them for WebViews
without WebGPU.
