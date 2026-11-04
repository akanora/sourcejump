-- The latest handshake from each keyed server: versions, loaded plugins and compliance, as reported on
-- map start. Kept as the server sent it; the server list and compliance views read it (slice 6).
CREATE TABLE server_handshakes (
    server_id bigint PRIMARY KEY REFERENCES servers (id),
    report jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

-- Published builds of sourcejump.smx. The plugin compares itself with the newest one on every map start.
CREATE TABLE plugin_releases (
    version text PRIMARY KEY CHECK (version <> ''),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    download_url text NOT NULL CHECK (download_url ~ '^https://'),
    released_at timestamptz NOT NULL DEFAULT now()
);
