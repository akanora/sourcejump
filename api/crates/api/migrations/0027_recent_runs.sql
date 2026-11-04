-- The Activity page's run list (`GET /v1/runs`): valid runs, newest first by the game server's clock.
CREATE INDEX runs_recent ON runs (finished_at DESC, id DESC) WHERE invalidated_at IS NULL;
