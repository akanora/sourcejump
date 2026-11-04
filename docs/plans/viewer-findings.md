# Map optimization findings index
2026-10-26. Complete inventory of this investigation's findings and candidates, including work still untested. The goal is smaller downloads/storage and faster complete-map loading with current appearance preserved; progressive display is optional, not a requirement.

## Evidence and current status
- [Loading and lossless packing](viewer-optimization.md): implemented changes, packing results, parser verification, performance marks and outstanding browser/database checks.
- [Texture study](viewer-texture-study.md): the `?texcap=` comparison switch and the adopted 1024 px cap (lead, 2026-10-27): 18 local maps 17% smaller.
- Workspace-local evidence: `backend/mapandreplays/lossless-2026-10-26/README.md` indexes the JSON, scripts and archived initial review. These private notes sit outside this repository; the two plans above and this index retain the conclusions here.
- Historical codec study: `backend/mapandreplays/bspv-writeup.md` and `maps/bspv/results-final.md`. Its download/decode estimates are not complete browser load measurements.

## What the data says
All MB are decimal. The 16 local packed maps are a convenience sample, not a representative library benchmark. They total 262.10 MB stored and 519.56 MB after Brotli decoding. Embedded pakfiles occupy 377.20 MB; their fully decoded assets occupy 696.04 MB because some entries still use LZMA. VTF textures account for 653.91 MB, about 94% of decoded assets. Liminal alone contributes 163.58 MB stored and 445.09 MB of textures.

Excluding Liminal, the other 15 maps contain 208.82 MB of textures. Existing mip levels above 512 and 1024 pixels account for 82.74 and 31.59 MB respectively. These are raw payload counts, not download savings. A mip cap removes fine detail; visual acceptability remains unknown.

Exact hashing found 34.32 MB of repeated decoded assets: 13.52 MB within maps and 20.80 MB across maps. The older 100-map study reported 9–17% repeated pakfile content. Neither predicts stored savings: Brotli already compresses nearby duplicates, and separate objects add overhead. Duplication against stock assets has not been measured.

The inventory also flagged 12.20 MB of lump data absent from the viewer's supported lump enumeration. This is a removal-audit candidate, not proof all such bytes are safe to discard. Retain collision data used by zone editing. Additional removal saved only 0.1–0.4% after q11 compression on three maps; grouping embedded assets saved only 0.085% overall in the q9 screening pass and made some maps larger. Neither packing change was adopted.

## Implemented and retained
- Concurrent map, replay and stock-index loading removes avoidable ordering. Fewer response/buffer copies reduce explicit allocation work. Parser output matched on all 16 maps. Browser speed is measured in the loading plan; peak memory remains unmeasured.
- Retain stripped BSP plus native HTTP Brotli q11/window 24, immutable content-derived URLs, shared stock VPKs with range reads, on-demand viewer loading and one map per comparison session. Native decoding can overlap download. LZMA expansion during packing remains memory-budgeted.
- The historical 50-map benchmark found BSPV only about 1.5% smaller than stripped Brotli BSP. Dictionary, byte-transposition and alternative-codec experiments did not establish a compelling replacement; xz's size gain carried slower decoding. No evidence supports replacing Rust or rewriting compression in assembly.

## Candidates still untested
| Candidate | Potential benefit and condition |
|---|---|
| Mobile texture delivery | Software DXT fallback already skips large mip levels around 512 after downloading them. Avoiding that transfer could help affected devices; establish actual device behavior first. |
| Proven-unused asset pruning | Build a dependency graph covering VMT includes/proxies, model materials, sky, cubemaps and entity effects. The current conservative stripper is not an exhaustive reachability analysis. |
| Shared content-hashed assets | A small BSP core plus per-map virtual-path manifest could reuse assets across maps and caches. Preserve map overrides; equal names do not imply equal bytes. Measure compression loss, requests and warm-cache reuse. |
| Dependency manifests/bundles | Material-to-texture discovery and stock range requests can create waterfalls. Precompute dependencies or group small files, guided by browser traces; increasing concurrency alone is not a demonstrated fix. |
| KTX2/Basis textures | Prototype size, quality and transcode cost. Existing DXT re-encoding can lose detail; UASTC is not automatically smaller. Mobile GPU formats require backend support. No encoding comparison exists yet. |
| Precompiled render data | Prebuild geometry/lightmaps/material dependencies if browser parsing proves costly. Mesh compression is a candidate, but textures dominate this sample. glTF/GLB conversion alone offers no guaranteed gain and must preserve Source behavior. |
| Progressive mips/spatial chunks | Deferred given the complete-map goal. Could reduce startup bytes without reducing total bytes. Whole-file Brotli is not randomly seekable; independently compressed chunks need conservative visibility, teleport/scrub/freecam handling and full-map zone editing. |

Browser validation of the loading changes is done (cold loads 9–26% faster at 50 Mbit/s; repeat visits no longer re-download stock textures; see the loading plan). Map textures are capped at 1024 px (texture study). HDR-to-LDR stripping can already differ from CS:S; compare in-game before claiming exact appearance.
