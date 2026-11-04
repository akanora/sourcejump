-- Makes the replays of the styles 0042 ranked (400 Velocity, Low Gravity, Autosync) public, like every other ranked
-- style's (lead, 2026-11-03). 0042 ranked them without this, so their replays were stored but never shown.
INSERT INTO policies (name, version, value)
VALUES ('replays', 4, '{"request": "new_personal_best", "public_styles": ["normal", "scroll", "hsw", "sw", "ad-only", "w-only", "bw", "400-vel", "low-grav", "autosync"]}');
