# Viewer loading and lossless packing review
See the [findings index](viewer-findings.md) for all measured results and untested candidates.

2026-10-26. The lead asked for smaller files and faster complete-map loading with current visual detail preserved. Texture downscaling, progressive display and a new container were not adopted.

**Status:** implemented and browser-validated below. Texture experiments are tracked in [viewer-texture-study.md](viewer-texture-study.md).

## Changes
- `viewer/loadMap.ts`: fetch the map and all three stock VPK indexes concurrently; parse the map while indexes are in flight. Preserve stock search order regardless of completion order, remove failed mount slots and keep map assets ahead of stock content.
- Replay loading starts scene preparation without waiting for the replay download. The zone editor uses the same map loader. Failure or cancellation stops related requests and disposes the renderer, including a BSP whose materials are still loading.
- Vendored `DataFetcher`: reuse downloaded chunks instead of cloning and reading additional response streams. A single full-buffer chunk is reused directly; partial views and multiple chunks are assembled exactly. Keep truncated-range cache retries; retry failed bodies, settle queued requests on cancellation and stop delayed retries after cancellation.
- Vendored `BSPFile`: finished vertex/index builders transfer their buffers instead of explicitly copying them. No changes to vertex precision, geometry, textures, lighting or the packed map format.

## Measurements
16 existing local viewer files, 262.10 MB stored and 519.56 MB after Brotli decoding. These are a convenience sample, with the 163.58 MB `kz_bhop_liminal` dominating stored size.

A lossless packing experiment grouped embedded assets by extension and content hash (Brotli q9 screening on both sides) made the 16 maps only 0.085% smaller (284,329,050 to 284,086,765 bytes); Forest grew 3.29%. Removing other unread lumps saved 0.1–0.4% at q11, and the earlier 50-map study found BSPV only 1.5% smaller. Production stays stripped BSP + Brotli q11.

The real-map parser benchmark verified identical fingerprints before/after buffer transfer on all 16 maps. Fingerprints cover parsed rendering and collision state. The transfer avoids copying 57.88 MB of geometry across the sample (16.62 MB on Liminal).

Single Node runs measured 3.23 s total Brotli decode and 5.52 s parsing before, versus 3.11 s and 5.30 s after. These are offline diagnostic timings, not browser results.

## Reproduce and finish browser validation
The optional test keeps copyrighted maps outside git. From `web/`, set `SJ_PACKED_MAPS` to a directory of Brotli viewer files named `*.bsp`:

```sh
SJ_PACKED_MAPS=/path/to/packed SJ_MAP_BENCH_OUTPUT=/tmp/before.json npm test -- --run src/features/replays/viewer/mapBenchmark.test.ts
# After a parser change, compare against the previous checkout's results:
SJ_PACKED_MAPS=/path/to/packed SJ_MAP_BENCH_BASELINE=/tmp/before.json SJ_MAP_BENCH_OUTPUT=/tmp/after.json npm test -- --run src/features/replays/viewer/mapBenchmark.test.ts
```

The browser Performance panel now records `replay:map-download`, `replay:stock-indexes`, `replay:bsp-parse`, `replay:materials` and `replay:map-ready`, with the map name in each measure's detail. Stages overlap and must not be summed. `map-ready` measures `Renderer.load`, excluding code/API loading and the first GPU frame; props and sky can finish later.

### Browser results (2026-10-26, second session)
Headless Chrome (software WebGL, Next dev build) loaded four replays from local storage, committed code against the working tree, two to three runs each, unthrottled and at 50 Mbit/s with 40 ms latency. Time is from clicking Watch replay until the loading notice clears (`materialsLoaded`); props and sky can finish later.

| Map, 50 Mbit/s 40 ms | Cold before | Cold after | Warm transfer before | Warm transfer after |
|---|---:|---:|---:|---:|
| bhop_candy_saarc | 3.26 s | 2.84 s | 2.66 MB | 0 |
| bhop_maze | 2.32 s | 2.12 s | 4.06 MB | 0 |
| bhop_lava | 3.40 s | 3.02 s | 19.44 MB | 0 |
| bhop_bfur | 3.24 s | 2.41 s | 0.04 MB | 0 |

Cold loads are 9–26% faster on the throttled link; unthrottled, 3–20%. No load failed or logged new errors. Warm load times did not change measurably, because the re-downloaded textures mostly arrive after the loading notice clears.

The warm-transfer column is a separate fix found during validation. Chrome keeps one HTTP cache entry per URL, and range requests that overlap in time on one entry are sent uncached. The viewer reads stock textures as concurrent ranges of one VPK part, so every replay re-downloaded them (up to 19.6 MB on lava). `DataFetcher` now names the range in the query (`?range=start-end`), which storage ignores; a repeat visit then reads them all from cache. The chosen storage provider (ADR 0006) must ignore unknown query parameters.

### Poster preparation and compressed indexes (2026-10-27)
The run page now loads the map's details and the viewer's code while the poster shows (once idle), so play starts the map download at once. The stock indexes are stored Brotli-compressed: 1.59 to 0.55 MB per first visit. Same harness, two seconds on the poster, cold medians at 50 Mbit/s 40 ms: candy 3.14 to 2.36 s, maze 2.19 to 1.50 s, lava 3.17 to 2.49 s, bfur 2.41 to 2.19 s. Poster preparation saved about 0.5 s (14–49%, warm included), indexes about 0.15 s. Dev builds load code slower than production, so the first saving is likely smaller there. The cost: about 120 KB of viewer code on run pages left unwatched.

Still not done: first-frame and GPU-upload timing, memory, phones, and fixed-camera image comparisons.

Download/concurrency tests and the 16-map fingerprint comparison passed. Nothing was deployed. Raw measurements and the packing script are in the workspace's `backend/mapandreplays/lossless-2026-10-26/`.
