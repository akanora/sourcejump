# 0007 Cloudflare R2 for object storage
**Status:** accepted   **Date:** 2026-10-28
**Context:** ADR 0006 put large files behind the S3 API and left the provider open. Most of the traffic is downloads: a replay view loads a map's viewer file (13 MB on average, up to 120 MB), and FastDL, if we host it, could serve terabytes. Stored data stays small: replays are 15-20 KB each, all viewer files together under 100 GB.
**Decision:** Cloudflare R2 (lead, 2026-10-28). Downloads are free; we pay $0.015 per GB-month stored and a small fee per request, past a free tier of 10 GB, 1 million writes and 10 million reads a month. Browsers read files from a custom domain on our Cloudflare zone, so its cache answers repeat reads; presigned uploads use the account's S3 endpoint. One bucket serves the public beta and then production; it's emptied at the switch (lead, 2026-10-28), and whether staff work from the beta (zones, pictures, viewer files) carries over is decided then. Its API token can reach that bucket only. Setup: `docs/deploy.md`.
**Rejected:**
- Backblaze B2: cheaper to store, but free downloads stop at three times what's stored, which FastDL would pass.
- Hetzner Object Storage: a flat monthly price including 1 TB of traffic, with traffic past that billed.
- Garage on our own storage VPS: one more server to run and back up.
**Revisit if:** R2 starts charging for downloads, or request fees grow past storage costs.
