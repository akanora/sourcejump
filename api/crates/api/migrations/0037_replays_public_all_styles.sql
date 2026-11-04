-- Every ranked style's replays are public, like Normal's: the 2026-10-14 poll only meant to keep segmented and
-- TAS replays private, and those aren't ranked styles (lead, 2026-11-03). A newly ranked style is added here
-- with a new version.
INSERT INTO policies (name, version, value)
VALUES ('replays', 3, '{"request": "new_personal_best", "public_styles": ["normal", "scroll", "hsw", "sw", "ad-only", "w-only", "bw"]}');
