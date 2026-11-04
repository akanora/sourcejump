-- Heartbeats from every server running the plugin, keyed or not, and the staff-kept list of servers shown
-- on the site. A server is its address: the IP its heartbeats come from and the game port it reports.

-- The latest heartbeat per address. `server_id` is set when it came with a valid key.
CREATE TABLE server_heartbeats (
    ip inet NOT NULL,
    port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
    server_id bigint REFERENCES servers (id),
    report jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ip, port)
);
CREATE INDEX server_heartbeats_received_at ON server_heartbeats (received_at);

-- Present means shown on the server list (lead, 2026-10-20). Kept apart from heartbeats so a listing
-- survives a server going quiet.
CREATE TABLE server_listings (
    ip inet NOT NULL,
    port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
    -- The staff member who listed it; NULL when listed from the CLI.
    listed_by bigint REFERENCES players (steamid64),
    listed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ip, port)
);

-- Handshakes carried no address, so their rows can't become heartbeats. They were only ever development data.
DROP TABLE server_handshakes;

-- Online: a heartbeat in the last 25 minutes (two missed beats). Listed servers silent for over 24 hours
-- leave the list until they return (lead, 2026-10-20).
INSERT INTO policies (name, version, value) VALUES ('servers', 1, '{"online_minutes": 25, "listed_hours": 24}');
