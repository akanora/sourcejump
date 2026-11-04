-- Tells the plugin it may follow record events: `record_events` for polling `GET /v1/records/events`,
-- `record_stream` for `GET /v1/records/stream` (lead, 2026-11-02). Features are switches; the plugin builds
-- both paths from its API address. The new version copies whichever ruleset is in force here, since each
-- environment's ruleset names its own zone source, and only adds the switches. A database with no ruleset yet gets
-- none.
INSERT INTO rulesets (version, document)
SELECT version + 1,
       jsonb_set(document, '{features}',
                 coalesce(document->'features', '{}'::jsonb) || '{"record_events": true, "record_stream": true}')
FROM rulesets
ORDER BY version DESC
LIMIT 1;
