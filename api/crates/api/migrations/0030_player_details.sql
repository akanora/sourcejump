-- What players say about themselves on their profile: their setup, and a country of their choosing. Checked by
-- the API (`players/details.rs`); the checks here only keep the table sane.
CREATE TABLE player_details (
    player_steamid64 bigint PRIMARY KEY REFERENCES players (steamid64),
    mouse text CHECK (length(mouse) BETWEEN 1 AND 48),
    dpi integer CHECK (dpi BETWEEN 50 AND 64000),
    sensitivity double precision CHECK (sensitivity > 0 AND sensitivity <= 100),
    mouse_pad text CHECK (length(mouse_pad) BETWEEN 1 AND 48),
    keyboard text CHECK (length(keyboard) BETWEEN 1 AND 48),
    monitor text CHECK (length(monitor) BETWEEN 1 AND 48),
    -- One of the ratios `players/details.rs` offers, as written there ("16:9").
    aspect text CHECK (length(aspect) BETWEEN 1 AND 16),
    -- When the player (or staff) last saved, for the pause between saves.
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A country the player picked overrides Steam's, which the profile refresh then leaves alone.
ALTER TABLE players ADD COLUMN country_chosen boolean NOT NULL DEFAULT false;
