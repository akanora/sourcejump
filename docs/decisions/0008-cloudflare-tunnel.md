# 0008 Cloudflare Tunnel in front; only SSH open
**Status:** accepted   **Date:** 2026-10-28
**Context:** ADR 0005 put Cloudflare's proxy in front of Caddy, which still meant ports 80 and 443 open to the internet and a certificate on the server. The lead wants the server to accept nothing but SSH (lead, 2026-10-28).
**Decision:**
- `cloudflared` runs on the server as a systemd service and connects out to Cloudflare. The tunnel and its public hostname are managed in the Cloudflare dashboard; the server holds only the tunnel token.
- Cloudflare ends TLS. Caddy listens on `127.0.0.1:80` over plain HTTP and still routes `/v1/*` and `/health` to the API and the rest to the web app.
- The firewall (ufw) denies all inbound traffic except SSH, which is rate-limited. SSH accepts keys only.
- Every request reaches Caddy from `127.0.0.1`, so Caddy sets `X-Forwarded-For` to Cloudflare's `Cf-Connecting-IP`, which Cloudflare overwrites on each request. The API keeps reading the last entry (`client_address.rs`).
**Rejected:**
- Proxied DNS record with 80 and 443 open: anyone who finds the server's address can skip Cloudflare.
- Opening 80 and 443 to Cloudflare's address ranges only: those ranges change and the list must be kept up to date.
**Revisit if:** Cloudflare stops carrying the traffic, or game servers need a path that bypasses Cloudflare.
