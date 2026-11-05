# Replays, maps and zones
Roadmap slice 8, split into smaller slices (lead, 2026-10-23). One idea runs through all of them: the browser loads a map, and replays and zones are drawn over it. Starting material: daf's handoff, kept outside the repo (map-compression study, 28 real replays, his `replay-viewer` source and his answers about it).

## Decided
- Valve's stock textures may be served to the viewer; if Valve objects, they come off (lead, 2026-10-23).
- daf's viewer code, and the `offstyles/replay-viewer` code by dowoge it grew from, may be used (lead, 2026-10-23 and 2026-10-24).
- Every ranked style's replays are public; segmented and TAS leaning private (poll 2026-10-14, lead 2026-11-03).
- Maps come from staff uploads; SourceJump keeps only the stripped viewer file. Runs and replays never wait for a map file. Stripping and compressing run on staff computers, not the server (lead, 2026-10-23).
- No storage provider yet; everything runs locally until the VPS deploy (lead, 2026-10-23).
- The viewer is built on daf's viewer core, with its UI rewritten in React; no WebAssembly unless profiling finds a hot spot (lead, 2026-10-24).

## Slices
| # | Slice | Status |
|---|---|---|
| 8a | Replay backend: uploads checked against their run, stored as SJR, raw download for public styles | done |
| 8b | Map files: each map stripped once for the viewer (daf's `viewerpack.py` rules), stored brotli-compressed | done |
| 8c-1 | Viewer core on `/runs/{id}`: daf's patched renderer and playback, SJR replays, stock VPKs from our storage; play/pause and a scrubber | done |
| 8c-2 | Viewer controls: keyboard (space, arrows, Home/End), speed, freecam, interpolation setting, run start/end marks and hover preview on the scrubber, fullscreen; the run dialog's "Watch replay" link. | done |
| 8c-3 | HUD: timer, speed, keys | done |
| 8c-4 | Comparison with the map's WR replay: live time and speed deltas | done |
| 8c-5 | Overlays: routes, player boxes, any run compared by ID (lead, 2026-10-26); in-game HUD, jump stats (community's call) | routes done |
| 8d | Zone editor: staff draw zone boxes over the rendered map and publish a zone set (staff-rework step 9) | done |

## 8a and 8b in short
- SJR: the shavit file losslessly reordered into per-field columns, delta-coded, gzipped (20–22% of raw on the samples; browsers gunzip it natively). Spec in `replays/sjr.rs`; checks and endpoints in `docs/api.md`.
- Viewer file: Rust port of `viewerpack.py` (now `sourcejump-packer`), byte-identical to it on 7 real maps; brotli q11, served with `Content-Encoding: br`. Spec: `docs/replay-viewer.md`. daf's BSPV container was not taken: browsers can't decode it themselves.
- Uploads (8b, lead 2026-10-26): no mirror job. Staff drop the map file on its Manage view; the browser packs it (Rust as WebAssembly) and the API re-strips it to check (`docs/staff-api.md`).

## 8c: the viewer
- Layout (lead, 2026-10-23): the player across the run page at 16:9, then one column of run details. Nothing loads until play is pressed; before that a poster draws the route from above (`replay.route`, built). The run dialog gets a "Watch replay" link.
- Why daf's core, not our prototype (unpatched noclip, outside the repo): his noclip copy carries fixes we'd otherwise rediscover: faces merged per spatial cell so culling survives bhop maps' thousands of leaves, brush-entity render modes, unlit maps, VMT quirks, software DXT decode and adaptive resolution for phones, plus playback (interpolation, teleport detection, run bounds checked on 247 replays).
- What changes from his: SJR replaces his wasm replay parser; the browser's brotli replaces his bz2 worker and map cache; noclip's debug-panel decorators are removed so it builds in Next.js without compiler flags; the UI is React on our design system (the HUD writes to the DOM directly, not through React state, at 60 Hz).
- Stock content: `cstrike_pak`, `hl2_textures`, `hl2_misc` (≈3.2 GB, stored once) in our bucket, read by range request; a visitor fetches the three `_dir.vpk` indexes (≈1.6 MB) and only the pieces a map uses. His per-file fallback route waits until a map shows it's needed.
- Checked rather than copied (8c-1): the map's pakfile wins over stock VPKs, as in Source; duck eye height stays 47 (CS:S's `VEC_DUCK_VIEW`); the intermittent `sofa_chair.mdl` error was Chrome's HTTP cache mixing two concurrent range requests, so short ranged reads now skip it (noclip README).
- Controls (8c-2, lead picked the overlay mockup, 2026-10-24): a bar over the picture that fades after 2.5 s of a playing replay left alone, with play, the run timer, and freecam, settings and fullscreen buttons; speed (¼× to 4×, shown in the bar when not 1×), smoothing (remembered per browser) and the shortcut list sit in the settings popover. Keys work while the player has focus, not page-wide.
- HUD (8c-3, daf's layout, lead, 2026-10-24): timer and speed bottom centre, keys bottom left, above the bar (its content height is `--replay-bar`), dropping when it fades. Keys hide on small players. No turn bars.
- Deltas (8c-4, inline as daf has them, lead, 2026-10-24): against the WR, or #2 when the run is the WR (named in settings), by daf's route matching (`viewer/replayDiff.ts`). Map detail names the WR; its run has the replay.
- Zone editor (8d, lead picked mockup C): `/maps/{map}/manage/zones`, placed as in shavit's zone menu (corner, corner, wheel for height), cursor-aimed. All of shavit's zone types, one track at a time (`zoneKinds.ts`).
- Freecam differs from daf's in one way: where the browser refuses to capture the mouse, it stays on and turns by dragging instead of dropping back. The run dialog links to `/runs/{id}#replay`, which starts the replay on arrival.
- Still to check: Firefox, Safari and phones (the lead checked playback and the editor, 2026-10-26).
- Fallback renderer if noclip proves hard: github.com/JofengSeir/websurf (MIT, Rust/WASM + Three.js).
