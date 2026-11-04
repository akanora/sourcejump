-- A server holds one key at a time; issuing a new one replaces the old in the same step (lead, 2026-10-21).
-- A server already holding several active keys keeps its newest; the others are revoked here, and logged as
-- revoked from the command line so the staff log still accounts for every key.
WITH extra AS (
    UPDATE server_keys k SET revoked_at = now()
    WHERE k.revoked_at IS NULL
      AND EXISTS (
          SELECT 1 FROM server_keys newer
          WHERE newer.server_id = k.server_id AND newer.revoked_at IS NULL AND newer.id > k.id
      )
    RETURNING k.prefix, k.server_id
)
INSERT INTO staff_log (actor_steamid64, action, target, reason, detail)
SELECT NULL, 'revoke_key', e.prefix, 'One key per server: replaced by its newest key',
       jsonb_build_object('server_id', s.id, 'server', s.name)
FROM extra e JOIN servers s ON s.id = e.server_id;

CREATE UNIQUE INDEX server_keys_one_active ON server_keys (server_id) WHERE revoked_at IS NULL;
