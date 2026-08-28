-- Generic polymorphic comment table for all dynamic tables.
-- No FK on row_id — dynamic tables have no stable constraint target.

CREATE TABLE IF NOT EXISTS system_comments (
    id              SERIAL PRIMARY KEY,
    table_name      TEXT        NOT NULL,
    row_id          INTEGER     NOT NULL,
    comment_text    TEXT        NOT NULL CHECK (char_length(comment_text) BETWEEN 1 AND 5000),
    created_by      INTEGER     REFERENCES system_users(id) ON DELETE SET NULL,
    created         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_comments_lookup
    ON system_comments (table_name, row_id, created DESC);

-- Updated trigger (project pattern)
CREATE OR REPLACE FUNCTION set_system_comments_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_system_comments_timestamp'
  ) THEN
    CREATE TRIGGER update_system_comments_timestamp
      BEFORE UPDATE ON system_comments
      FOR EACH ROW EXECUTE FUNCTION set_system_comments_updated_timestamp();
  END IF;
END $$;
