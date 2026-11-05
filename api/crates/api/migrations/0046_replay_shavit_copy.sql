-- The shavit file, rebuilt from SJR on a replay's first download and kept, so later downloads are passed on
-- from storage instead of rebuilt in memory each time (backend audit 2026-11-05). It sits next to the SJR
-- under the same random key, so only the API knows where; the API still decides who gets it.
ALTER TABLE replays ADD COLUMN shavit_key text UNIQUE;
