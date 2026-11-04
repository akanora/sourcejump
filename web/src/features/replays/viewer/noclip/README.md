# noclip (vendored)
noclip.website's Source engine renderer (MIT, `LICENSE`), taken from daf's replay viewer (`../../../../../../../backend/mapandreplays/replay-viewer/src/noclip/`, 2026-10-24) rather than from upstream, because his copy carries fixes for bhop maps: faces merged per spatial cell so PVS culling survives maps with thousands of leaves, brush-entity render modes, unlit maps, VMT tokenizer quirks, software DXT decode for phones, and stubs that cut noclip's debug UI and its Rust/WASM library. His answers in `../../../../../../../backend/mapandreplays/answers-for-sourcejump.md` (Q1–Q3, Q9) list them.

Files are kept as close to that copy as possible so later fixes can be diffed in. They start with `// @ts-nocheck` and are excluded from lint and formatting. Only the files the renderer reaches are kept.

## Changes on top of daf's copy (marked `LOCAL:`)
- `DebugFloaters.ts` removed, with its `@dfShow`/`@dfRange` uses in `SourceEngine/Main.ts` and `SourceEngine/Materials/MaterialBase.ts`, so the site builds without `experimentalDecorators`.
- `SourceEngine/Main.ts`: the map's pakfile is searched before the game VPKs, as in Source.
- `DataFetcher.ts`: a ranged read whose body is shorter than asked is fetched again past the browser cache (Chrome can mix up concurrent range requests on one file; this was the intermittent `sofa_chair.mdl` error), and a single-chunk response is used as is only when the chunk spans its whole buffer (daf's lead; correct, but not the cause).
- `Geometry.ts`: `sqDistFromClosestPoint` reads `max[0]` for X (upstream fix).
- Class fields declared without an initializer are marked `declare` (467 of them, and `override` dropped where both met; not marked `LOCAL:`). noclip is written for TypeScript's `useDefineForClassFields: false`, but Turbopack emits ES2022 class fields whatever tsconfig says, and those reset a field a subclass only declares after the base constructor set it: every material lost its shader type, and with it its lightmap, so lit maps drew unlit.
- Relative imports lost their `.js` extension, which Turbopack doesn't map to `.ts` (not marked; strip it before diffing).
- `SourceEngine/StaticDetailObject.ts`: a static prop that fails to load logs a warning instead of nothing.
- `SourceEngine/DXT.ts` (daf's own file) got the `// @ts-nocheck` the others have.
- `SourceEngine/BSPFile.ts`: completed geometry builders transfer their buffers instead of copying them; parsed rendering and collision data matched on 16 real maps (`docs/plans/viewer-optimization.md` in the repo root).
- `DataFetcher.ts`: asset bodies are assembled from the chunks already read for progress, without cloned streams unless the optional Cache API store needs one. Interrupted bodies retry; cancellation settles queued requests as well as active ones, and scheduled retries do not restart after cancellation.
- `DataFetcher.ts`: range requests carry their range in the query (`?range=start-end`). Chrome otherwise leaves concurrent range requests on one archive uncached, so every replay re-downloaded its stock textures.
- `SourceEngine/VTF.ts`, `SourceEngine/Materials/MaterialCache.ts`: a test-only texture size limit (`setLevelCap`, `setTextureLevelCap`) that swaps samplers to skip the largest mip levels, for `?texcap=`.
- `SourceEngine/BSPFile.ts`, `Main.ts`, `Materials/MaterialBase.ts`: brush surfaces carry their texdata size (`mappingSize`), and a texture smaller than it by a power of two (capped by the viewer packer) tiles at that size.
