# Golden Sample: SQL Migration

This file serves as a reference implementation for database migrations.
It is stored as a `.md` file to prevent execution, but the code block below is valid SQL.

```sql
-- 20251220000000_golden_sample_migration.sql
--
-- This migration creates the 'golden_sample_items' table and associated indexes.
-- It operates between the application's data model and the PostgreSQL database storage.
-- It exists to persist sample items and ensure efficient querying via proper indexing,
-- serving as a template for future schema changes.
-- VERSION_DB: 5.0.2

-- 1. Use IF NOT EXISTS to prevent errors on re-runs
CREATE TABLE IF NOT EXISTS golden_sample_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create indexes for frequently queried columns
-- Always use IF NOT EXISTS for indexes as well
CREATE INDEX IF NOT EXISTS idx_golden_sample_items_status ON golden_sample_items(status);

-- 3. Add comments to columns if the purpose isn't obvious
COMMENT ON COLUMN golden_sample_items.status IS 'Current state: active, archived, or deleted';

-- 4. Data Migration (if applicable)
-- Use INSERT ... SELECT ... WHERE NOT EXISTS to avoid duplicates
INSERT INTO golden_sample_items (name, description)
SELECT 'Example Item', 'Created by migration'
WHERE NOT EXISTS (
    SELECT 1 FROM golden_sample_items WHERE name = 'Example Item'
);

-- 5. One migration owns the logical DB release history row
INSERT INTO system_db_version (version, description)
SELECT '5.0.2', 'Added golden_sample_items'
WHERE NOT EXISTS (
    SELECT 1 FROM system_db_version WHERE version = '5.0.2'
);
```

If several migrations ship under the same `VERSION_DB`, exactly one owns the
idempotent history-row insert. Every other migration in that release must
declare `-- VERSION_DB_OWNER: <owner migration filename>` and must not repeat
the insert. A few historical repair migrations both delegate authority and
repeat an idempotent insert; that compatibility exception is not a new-release
pattern.
