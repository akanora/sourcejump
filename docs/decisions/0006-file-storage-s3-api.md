# 0006 Large files behind the S3 API; provider chosen later
**Status:** accepted; provider chosen in 0007   **Date:** 2026-10-19
**Context:** Replays (PB-only: tens to low hundreds of GB over time), FastDL `.bsp.bz2` files and web map geometry (a few hundred GB at most) don't fit on the VPS's 50 GB disk. The plugin uploads replays directly to a presigned URL, so files never pass through the API.
**Decision:** The API talks to storage only through the S3 API (presigned PUT/GET, object keys). In development, a local S3-compatible server stands in, so the presigned flow is the same as in production. The provider is chosen before the first deploy; the replay slice is built against local S3 (lead, 2026-10-20). Candidates: Cloudflare R2 (free egress, the leading option for public FastDL), Backblaze B2, Hetzner Object Storage, or a self-hosted S3-compatible server such as Garage on a cheap storage VPS.
**Rejected:**
- Files on the VPS disk: too small, and downloads would compete with the API for bandwidth.
- A custom file-server protocol: it would mean writing our own presigning, uploads and cache headers.
**Revisit if:** the provider decision is made; record it as a new ADR.
