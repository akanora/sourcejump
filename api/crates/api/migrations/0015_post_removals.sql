-- Staff removing someone else's post is a logged staff action; this links the post to that log entry, whose
-- reason the hidden-posts list shows. NULL while the post is shown, and for a post its author removed.
ALTER TABLE posts
    ADD COLUMN hidden_log_id bigint UNIQUE REFERENCES staff_log (id),
    ADD CHECK (hidden_log_id IS NULL OR hidden_at IS NOT NULL);
