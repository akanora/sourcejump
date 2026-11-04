#!/usr/bin/env bash
# One-time setup of a fresh Debian or Ubuntu VPS: Postgres 18, Caddy, Node 24, cloudflared, the firewall, the
# sourcejump user, its database and env files. Safe to run again. Run as root through `just provision <environment>`.
# Connecting the tunnel takes its token from the Cloudflare dashboard, one time: docs/deploy.md.
set -euo pipefail

apt-get update
apt-get install -y curl gnupg rsync postgresql-common debian-keyring debian-archive-keyring apt-transport-https

# Distributions often ship an older Postgres; the PostgreSQL project's repository has 18.
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
# Caddy's official repository: https://caddyserver.com/docs/install#debian-ubuntu-raspbian
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
  gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
# Node 24 from NodeSource: https://github.com/nodesource/distributions
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
# cloudflared from Cloudflare's repository: https://pkg.cloudflare.com/index.html
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  >/etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y postgresql-18 caddy nodejs cloudflared ufw nftables

# Traffic arrives through the Cloudflare Tunnel (ADR 0008), so only SSH is open, and only with keys. The drop-in
# sorts before cloud-init's, and sshd keeps the first value it reads.
cat >/etc/ssh/sshd_config.d/10-sourcejump.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh
ufw default deny incoming
ufw default allow outgoing
ufw limit OpenSSH
ufw --force enable

# Drop IPv4 packets that carry IP options: legitimate traffic doesn't use them, and they are what CVE-2026-98432 (a
# remote TCP use-after-free) needs. Its own table and unit, not nftables.service, whose config flushes ufw's rules.
cat >/etc/nftables-ipopts.nft <<'EOF'
table inet ipopts
delete table inet ipopts
table inet ipopts {
	chain prerouting {
		type filter hook prerouting priority -300; policy accept;
		ip hdrlength != 5 drop
	}
}
EOF
cat >/etc/systemd/system/drop-ip-options.service <<'EOF'
[Unit]
Description=Drop IPv4 packets with IP options
DefaultDependencies=no
Wants=network-pre.target
Before=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/nftables-ipopts.nft
ExecStop=/usr/sbin/nft delete table inet ipopts

[Install]
WantedBy=sysinit.target
EOF
systemctl daemon-reload
systemctl enable drop-ip-options
systemctl restart drop-ip-options

# Postgres sized for a small box it shares with Node (the beta VPS has 2 GB).
cat >/etc/postgresql/18/main/conf.d/10-sourcejump.conf <<'EOF'
max_connections = 40
shared_buffers = 256MB
effective_cache_size = 768MB
work_mem = 8MB
maintenance_work_mem = 64MB
EOF
systemctl restart postgresql

id sourcejump >/dev/null 2>&1 ||
  useradd --system --home-dir /opt/sourcejump --shell /usr/sbin/nologin sourcejump
install -d -m 755 /opt/sourcejump /opt/sourcejump/api /opt/sourcejump/web
install -d -m 750 -g sourcejump /etc/sourcejump

# The API connects over the local socket as the sourcejump OS user (peer authentication): no password to keep.
as_postgres() { runuser -u postgres -- "$@"; }
as_postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'sourcejump'" | grep -q 1 ||
  as_postgres createuser sourcejump
as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'sourcejump'" | grep -q 1 ||
  as_postgres createdb --owner sourcejump sourcejump

[ -f /etc/sourcejump/api.env ] || cat >/etc/sourcejump/api.env <<'EOF'
DATABASE_URL=postgres:///sourcejump?user=sourcejump
SJ_BIND=127.0.0.1:8080
RUST_LOG=info
# Where players reach this environment, e.g. https://sourcejump.net. Steam sign-in returns here.
SJ_PUBLIC_URL=
# Object storage for replays and map images (ADR 0006); SJ_S3_PUBLIC_URL is where browsers read public
# files. The API won't start until these are filled in.
SJ_S3_ENDPOINT=
SJ_S3_REGION=
SJ_S3_BUCKET=
# Private, never public: staff uploads wait here until the API checks them.
SJ_S3_STAGING_BUCKET=
SJ_S3_ACCESS_KEY_ID=
SJ_S3_SECRET_ACCESS_KEY=
SJ_S3_PUBLIC_URL=
EOF
[ -f /etc/sourcejump/web.env ] || cat >/etc/sourcejump/web.env <<'EOF'
HOSTNAME=127.0.0.1
PORT=3000
SJ_API_URL=http://127.0.0.1:8080
# Caps Node's heap so the web app can't crowd out Postgres on a small box.
NODE_OPTIONS=--max-old-space-size=384
EOF
chgrp sourcejump /etc/sourcejump/*.env
chmod 640 /etc/sourcejump/*.env
