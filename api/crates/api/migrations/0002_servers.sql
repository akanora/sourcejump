-- Game servers and the API keys that let them submit. One server can hold several keys over time
-- (a key is revoked and replaced, never edited), and every run will reference the key it came with.
CREATE TABLE servers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (name <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE server_keys (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    server_id bigint NOT NULL REFERENCES servers (id),
    -- The start of the key: enough to tell keys apart in logs and staff tools without revealing them.
    prefix text NOT NULL UNIQUE,
    -- SHA-256 of the whole key. The key itself is shown once when issued and never stored.
    hash bytea NOT NULL UNIQUE CHECK (length(hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
