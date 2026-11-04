-- Adds 400 Velocity, Low Gravity and Autosync to the ranked styles, provisionally for public testing (lead,
-- 2026-11-04). Their settings are shavit's styles config on the OK servers (daf, 2026-11-04), written out over
-- Normal's like the styles in 0041. 400 Velocity is a scroll style, so like Scroll it goes without the landfix
-- (lead). Autosync is flagged `autosync`: the plugin syncs strafes itself, where the OK servers used
-- shavit-syncstyle. Unlike there, it's not segmented (daf), so its settings equal Normal's and only the flag tells
-- the two apart. Like 0041, the new version copies the ruleset in force and appends to its styles.
INSERT INTO rulesets (version, document)
SELECT version + 1, jsonb_set(document, '{styles}', document->'styles' || '
[
  {
    "key": "400-vel",
    "name": "400 Velocity",
    "flags": [
      "nolandfix"
    ],
    "settings": {
      "autobhop": "0",
      "easybhop": "0",
      "bunnyhopping": "1",
      "prespeed": "0",
      "prespeed_type": "-1",
      "velocity_limit": "400.00",
      "airaccelerate": "100.0",
      "runspeed": "250.00",
      "gravity": "1.0",
      "speed": "1.0",
      "timescale": "1.0",
      "velocity": "1.0",
      "bonus_velocity": "0.0",
      "min_velocity": "0.0",
      "jump_multiplier": "0.0",
      "jump_bonus": "0.0",
      "nozaxisspeed": "-1",
      "blockprejump": "-1",
      "startinair": "0",
      "edgejump": "0",
      "halftime": "0",
      "block_w": "0",
      "block_a": "0",
      "block_s": "0",
      "block_d": "0",
      "block_use": "0",
      "a_or_d_only": "0",
      "force_hsw": "0",
      "block_pleft": "1",
      "block_pright": "1",
      "block_pstrafe": "1",
      "segments": "0",
      "sync": "1",
      "kzcheckpoints": "0",
      "tas": "0",
      "autostrafe": "0",
      "autoprestrafe": "0",
      "autojumponstart": "0"
    }
  },
  {
    "key": "low-grav",
    "name": "Low Gravity",
    "flags": [],
    "settings": {
      "autobhop": "1",
      "easybhop": "1",
      "bunnyhopping": "1",
      "prespeed": "0",
      "prespeed_type": "-1",
      "velocity_limit": "0.0",
      "airaccelerate": "1000.0",
      "runspeed": "260.00",
      "gravity": "0.5",
      "speed": "1.0",
      "timescale": "1.0",
      "velocity": "1.0",
      "bonus_velocity": "0.0",
      "min_velocity": "0.0",
      "jump_multiplier": "0.0",
      "jump_bonus": "0.0",
      "nozaxisspeed": "-1",
      "blockprejump": "-1",
      "startinair": "0",
      "edgejump": "0",
      "halftime": "0",
      "block_w": "0",
      "block_a": "0",
      "block_s": "0",
      "block_d": "0",
      "block_use": "0",
      "a_or_d_only": "0",
      "force_hsw": "0",
      "block_pleft": "0",
      "block_pright": "0",
      "block_pstrafe": "0",
      "segments": "0",
      "sync": "1",
      "kzcheckpoints": "0",
      "tas": "0",
      "autostrafe": "0",
      "autoprestrafe": "0",
      "autojumponstart": "0"
    }
  },
  {
    "key": "autosync",
    "name": "Autosync",
    "flags": [
      "autosync"
    ],
    "settings": {
      "autobhop": "1",
      "easybhop": "1",
      "bunnyhopping": "1",
      "prespeed": "0",
      "prespeed_type": "-1",
      "velocity_limit": "0.0",
      "airaccelerate": "1000.0",
      "runspeed": "260.00",
      "gravity": "1.0",
      "speed": "1.0",
      "timescale": "1.0",
      "velocity": "1.0",
      "bonus_velocity": "0.0",
      "min_velocity": "0.0",
      "jump_multiplier": "0.0",
      "jump_bonus": "0.0",
      "nozaxisspeed": "-1",
      "blockprejump": "-1",
      "startinair": "0",
      "edgejump": "0",
      "halftime": "0",
      "block_w": "0",
      "block_a": "0",
      "block_s": "0",
      "block_d": "0",
      "block_use": "0",
      "a_or_d_only": "0",
      "force_hsw": "0",
      "block_pleft": "0",
      "block_pright": "0",
      "block_pstrafe": "0",
      "segments": "0",
      "sync": "1",
      "kzcheckpoints": "0",
      "tas": "0",
      "autostrafe": "0",
      "autoprestrafe": "0",
      "autojumponstart": "0"
    }
  }
]
'::jsonb)
FROM rulesets
ORDER BY version DESC
LIMIT 1;
