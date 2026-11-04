-- Searching maps and players by name (`name_search.rs`): trigram indexes serve both the "contains" match
-- (ILIKE '%…%') and the near-miss match for typos (`<%`). pg_trgm is a trusted extension, so the database's
-- owner can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX maps_name_search ON maps USING gin (name gin_trgm_ops);
CREATE INDEX players_name_search ON players USING gin (name gin_trgm_ops);
CREATE INDEX legacy_players_name_search ON legacy_players USING gin (name gin_trgm_ops);
