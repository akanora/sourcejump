# Texture quality and map delivery study
See the [findings index](viewer-findings.md) for the complete investigation inventory.

2026-10-26. Continuation of [viewer-optimization.md](viewer-optimization.md). **Decided 2026-10-27: map textures are capped at 1024 px** (lead, after comparing with `?texcap=`); see the result below.

## What is complete
An offline experiment removed existing DXT1/3/5 mip levels above 512 pixels from three already-packed maps and recompressed them. Baseline and variants used the same native Brotli q11/window-24 encoder. MB below is decimal. Baselines were recompressed too, so these numbers differ slightly from files made by the Rust encoder.

| Map | Full texture detail, MB | 512-pixel cap, MB | Reduction |
|---|---:|---:|---:|
| bhop_candy_saarc | 3.95 | 1.01 | 74.4% |
| bhop_forest | 22.66 | 10.24 | 54.8% |
| bhop_effigy | 15.67 | 14.96 | 4.5% |

These savings come from discarding image detail, not improved lossless compression. Only depth-1 DXT textures with existing smaller mip levels were changed. Uncompressed texture formats and textures without suitable mipmaps were untouched; this explains much of Effigy's smaller saving. Geometry and lighting payloads were unchanged.

All removed payload in Candy came from two textures: `urban_trees_branches03.vtf` (2048×2048) and `urban_trees_barks01.vtf` (1024×2048). Forest's reductions were mainly foliage too. Thus a large file reduction can affect a small subset of the scene. Whether it looks acceptable has **not** been established.

Persistent evidence is in the workspace's `backend/mapandreplays/lossless-2026-10-26/`: `mipmap-sizes-512.json`, `asset-inventory.json` and the archived `mipmap-size-prototype.py`. The prototype retains its original session paths and is size-only, not a production converter.

## Comparison switch
`?texcap=full|1024|512` on a replay or zone-editor address shows a label; T cycles the cap live. The sampler's minimum LOD skips the larger mip levels (`VTF.setLevelCap`), so nothing reloads. It shows the look, not bytes. Most stock textures are 512 px or smaller and don't change.

## 1024 cap in the packer (2026-10-27)
`viewer-pack/src/vtf.rs` drops embedded DXT1/3/5 textures' levels above 1024 px: the largest levels are the end of a VTF's image data, so the tail is cut and the header halved. Cubemaps, volume textures, other formats and any file whose computed layout doesn't match to the byte stay as they are. LZMA textures are decoded first, so huge maps are capped too. Already-packed files fail the upload check until packed again.

Brush faces tile by texture size, so the viewer now takes it from the BSP's texdata when a texture is smaller by a power of two (`MaterialBase.calcTexCoord0Scale`); models use normalised UVs. Check: with that disabled, Interloper's capped concrete visibly tiles denser; with it, capped files render pixel-identical to the originals at `?texcap=1024`.

The 18 local viewer files, repacked: 307.09 to 253.98 MB (-17.3%). Liminal 163.58 to 125.43, Interloper 42.81 to 36.93, Forest 22.74 to 15.92, Candy 3.96 to 1.76, Twisty 0.88 to 0.84; twelve maps had no texture over 1024 and are byte-identical.

Not done: phones (the software-DXT path already caps at 512), KTX2/Basis, and a production repack once storage exists.

"Full detail" means the viewer's previous texture data. Matching CS:S needs an in-game reference: the packer already prefers LDR over HDR, and Candy's lighting already differed before any mip change.
