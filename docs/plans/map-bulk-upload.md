# Map bulk upload
Getting every map's viewer file into SourceJump before launch. Today staff pack one map at a time on its Manage view, in WebAssembly (3–4 s per MB, one core, the tab kept open), which doesn't scale to the whole map list. Builds on 8b (`replays-and-maps.md`).

## Decided
- A command-line packer for bulk work, for Linux and Windows. Staff split the map list between them and each packs a folder of maps (lead, 2026-10-30).
- The lead distributes sj-pack to staff as one zip holding the Linux and Windows builds. It moved to its own public repo the same day, so people can inspect the code before running the .exe (lead, 2026-10-30).
- The bulk page packs too, in the browser on several cores, for staff who'd rather not run the CLI; the CLI stays the faster way for the big first batch (lead, 2026-10-30).
- SourceJump still keeps only the viewer file, not the original map (lead, 2026-10-30).
- Viewer files upload straight to storage through a presigned link, not through the API: Cloudflare's proxy, in front of the API since the tunnel (ADR 0008), refuses request bodies over 100 MB on its plan, and packed maps reach 163 MB. The link is contained: one private staging key, short-lived. Staff see no change; they still drop a file (lead, 2026-10-30).

## Slices
| # | Slice | Status |
|---|---|---|
| 1 | Presigned viewer-file upload, used by the Manage view | done |
| 2 | `sj-pack` CLI: packs a folder of maps into upload-ready files | done; released from the `sourcejump-packer` repo |
| 3 | Bulk upload on the staff Maps page: drop the CLI's output folder, or a folder of maps to pack in the browser | done |

## 1. Presigned upload
- Staff with `manage_maps` or `manage_zones` ask for a link for one map; the API answers with a presigned PUT to `viewer/{map}-{random}` in a **private** staging bucket, valid 15 minutes. Staging is never served publicly: a public staging key would let a link's holder serve any file from our domain.
- The browser uploads, then tells the API it's done. The API reads it, stopping past 256 MB, runs `viewer_pack::check`, and stores **the bytes it checked** under `maps/viewer/{map}-{hash}.bsp` as today; never a copy of whatever staging holds by then. Then it deletes the staging object.
- A lifecycle rule on the staging bucket deletes anything older than a day, so abandoned or refused uploads cost nothing for long.
- Links are secrets while valid: never logged, never put in a page URL.
- Replaces the body-carrying `PUT …/viewer-file`; the CLI's `maps viewer-file` keeps writing directly. Deploy: the staging bucket, its lifecycle rule and its CORS rule (PUT from the site) go in `docs/deploy.md`; locally `scripts/dev-s3.sh` makes it.

## 2. The CLI
- In the public `sourcejump-packer` repo (github.com/sourcejump/sourcejump-packer), with the packer itself (`viewer-pack`), so staff can read the code before running it; this repo pins `viewer-pack` by git revision. `sj-pack` is a thin binary over `viewer_pack::pack()`; the packing is the same code the browser runs, so the API's check accepts its output unchanged. Native, it's about twice as fast per map as WebAssembly (1.8 s per MB on stock maps), and it packs up to 4 maps at once (`--jobs` to change it): 4 stock maps of 10–25 MB peak at 0.8 GB together.
- Run in, or pointed at, a folder of `.bsp` and `.bsp.bz2` files. For each map it writes `packed/{map}.viewer.br`.
- Output is written to a `.part` file and renamed when done, so an interrupted run leaves no half files. Maps already in `packed/` are skipped, so stopping and running again resumes, and a folder can be handed to someone else mid-way.
- Shows the map being packed with its stage (unpacking, stripping, compressing %), maps done of total, and time left. Ends with a summary and the maps that failed and why (not a map, invalid name, over the size limits). Map names come from file names, lowercased and checked by the same rules as `MapName`.
- Released by that repo's GitHub Actions from a version tag, for `x86_64-unknown-linux-musl` and `x86_64-pc-windows-gnu`, zipped together, with SHA-256 sums and a build attestation once the repo is public; single files, nothing to install. Windows warns once about an unsigned program (More info, Run anyway). Double-clicked on Windows, it packs the folder it sits in and waits for Enter before closing.

## 3. Bulk upload
- The Maps page's "Map files" staff tab (`BulkUpload.tsx`). Staff drop the folder sj-pack ran in, its `packed/` folder, or a folder of maps; one file per map, preferring a packed one. `GET /v1/staff/viewer-files` says which maps have a file and its hash.
- Maps that have a file are left alone unless staff tick "Replace their files": a packed file's hash isn't known without decoding it. A map packed in the page whose hash matches the stored one is skipped either way.
- Two to four maps at a time (half the cores), each packed in its own Web Worker if needed, then uploaded through slice 1's flow with upload progress; failed ones are retried by starting again. Leaving the page asks first, and stops the queue; dropping the folder again picks up where it left off.
- Locally, the API's debug build checks a 95 MB upload in about 50 s, past the Next dev proxy's timeout, so large uploads fail there; the release build takes 7.5 s for 180 MB.

## Open questions
- Who packs which maps, and from which source (a FastDL mirror, the old site's files): the staff's call, outside this repo.
