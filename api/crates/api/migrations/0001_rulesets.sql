-- Rulesets: the versioned rules the plugin applies on every map start.
-- Every run records the version it was played under, so a published version must never change:
-- a change to the rules is a new row with a higher version.
CREATE TABLE rulesets (
    version integer PRIMARY KEY CHECK (version > 0),
    -- Everything except the version; the API's `RulesetDocument` type is its shape.
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION rulesets_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ruleset version % is immutable; publish a new version instead', OLD.version;
END;
$$;

CREATE TRIGGER rulesets_immutable
    BEFORE UPDATE OR DELETE ON rulesets
    FOR EACH ROW EXECUTE FUNCTION rulesets_reject_change();
