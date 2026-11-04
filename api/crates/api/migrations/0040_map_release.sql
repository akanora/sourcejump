-- When a map was released and who made it, set by staff and shown under the map's name (lead, 2026-11-03).

ALTER TABLE maps
    -- To the precision staff know it: a year, a month of a year, or a day.
    ADD COLUMN released_year smallint CHECK (released_year >= 1990),
    ADD COLUMN released_month smallint CHECK (released_month BETWEEN 1 AND 12),
    ADD COLUMN released_day smallint CHECK (released_day BETWEEN 1 AND 31),
    ADD CHECK (released_month IS NULL OR released_year IS NOT NULL),
    ADD CHECK (released_day IS NULL OR released_month IS NOT NULL),
    -- A player row, created when staff name someone who hasn't played, so the name links to a profile.
    ADD COLUMN mapper_steamid64 bigint REFERENCES players (steamid64);
