-- Where each server is, and which listed servers only let in players they've approved (lead, 2026-11-03).

-- The country Cloudflare places the heartbeat's IP in (its CF-IPCountry header). NULL when it gave none, as
-- in development.
ALTER TABLE server_heartbeats ADD COLUMN country_code text CHECK (country_code ~ '^[A-Z]{2}$');

-- Set by staff. The server list shows public and whitelist servers apart, public by default.
ALTER TABLE server_listings ADD COLUMN whitelist boolean NOT NULL DEFAULT false;
