# Vendored Anime4K WebGPU pipelines

WGSL ports of [Anime4K](https://github.com/bloc97/Anime4K) (MIT, © bloc97)
from [Anime4K-WebGPU](https://github.com/Anime4KWebBoost/Anime4K-WebGPU)
(MIT, see `LICENSE.md`), commit `ad1ef0c010fd0d69371d0e2a340ab1bffc38d24b`.

Only what Kuriume runs is kept: `ClampHighlights` and its helpers, the
`CNNM` / `CNNVL` restore networks and the `CNNx2M` / `CNNx2VL` upscalers, and
the presentation shaders. Local changes:

- WGSL imports use Vite's `?raw` suffix instead of a webpack loader.
- Interface imports are `import type`; unused parameters are prefixed with `_`.

The renderer that drives these passes is `../renderer.ts`.
