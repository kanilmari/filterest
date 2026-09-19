-- 20260919000007_create_developer_ticket_schema.sql
-- Creates the current developer-ticket tables without importing installation records.
-- Bridges the shipped db_task command and ticket UI with their public database contract.
-- Exists so a standalone Filterest checkout can use its own development task tools.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

CREATE TABLE IF NOT EXISTS public.dev_agent_task_statuses (
    id           SERIAL PRIMARY KEY,
    slug         TEXT        NOT NULL UNIQUE,
    lang_key     TEXT        NOT NULL UNIQUE,
    title        TEXT        NOT NULL,
    description  TEXT,
    sort_order   INTEGER     NOT NULL DEFAULT 0,
    is_active    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_claimable BOOLEAN     NOT NULL DEFAULT FALSE,
    created      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_todo_statuses (
    id                   SERIAL PRIMARY KEY,
    slug                 TEXT        NOT NULL UNIQUE,
    lang_key             TEXT        NOT NULL UNIQUE,
    title                TEXT        NOT NULL,
    description          TEXT,
    sort_order           INTEGER     NOT NULL DEFAULT 0,
    is_completion_status BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal          BOOLEAN     NOT NULL DEFAULT FALSE,
    created              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_queues (
    updated     TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        VARCHAR(50),
    description VARCHAR(4000),
    id          SERIAL PRIMARY KEY,
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    slug        TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_groups (
    id          SERIAL PRIMARY KEY,
    slug        TEXT        NOT NULL UNIQUE,
    title       TEXT        NOT NULL,
    description TEXT,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.agent_tasks_id_seq AS INTEGER;

CREATE TABLE IF NOT EXISTS public.dev_agent_tasks (
    id           INTEGER     NOT NULL DEFAULT nextval('public.agent_tasks_id_seq'::regclass),
    title        TEXT        NOT NULL,
    status       TEXT        NOT NULL,
    created      TIMESTAMPTZ NOT NULL DEFAULT now(),
    content      TEXT        NOT NULL,
    updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
    priority     TEXT        NOT NULL DEFAULT 'normal',
    tags         TEXT[]      DEFAULT '{}'::TEXT[],
    parent_id    INTEGER     REFERENCES public.dev_agent_tasks(id) ON DELETE SET NULL,
    assigned_to  TEXT,
    issue_type   TEXT        NOT NULL DEFAULT 'task',
    cached_image TEXT,
    queue_id     INTEGER,
    CONSTRAINT agent_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT chk_dev_agent_tasks_issue_type
        CHECK (issue_type IN ('task', 'incident', 'bug', 'epic')),
    CONSTRAINT fk_dev_agent_tasks_queue_id
        FOREIGN KEY (queue_id) REFERENCES public.dev_agent_task_queues(id) ON DELETE SET NULL,
    CONSTRAINT fk_dev_agent_tasks_status
        FOREIGN KEY (status) REFERENCES public.dev_agent_task_statuses(slug) ON UPDATE CASCADE
);

-- Older composed installations may already own the base task table. Add only
-- fields introduced by its private migration history and retain any legacy
-- columns rather than discarding installation data.
ALTER TABLE public.dev_agent_tasks
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS parent_id INTEGER,
    ADD COLUMN IF NOT EXISTS assigned_to TEXT,
    ADD COLUMN IF NOT EXISTS issue_type TEXT NOT NULL DEFAULT 'task',
    ADD COLUMN IF NOT EXISTS cached_image TEXT,
    ADD COLUMN IF NOT EXISTS queue_id INTEGER;

ALTER TABLE public.dev_agent_tasks
    ALTER COLUMN id SET DEFAULT nextval('public.agent_tasks_id_seq'::regclass);
ALTER SEQUENCE public.agent_tasks_id_seq OWNED BY public.dev_agent_tasks.id;

CREATE TABLE IF NOT EXISTS public.dev_agent_task_runs (
    id                 BIGSERIAL PRIMARY KEY,
    run_id             TEXT        NOT NULL UNIQUE,
    task_id            INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    triggered_by       TEXT        NOT NULL,
    worker_backend     TEXT,
    status             TEXT        NOT NULL DEFAULT 'queued',
    summary_relpath    TEXT,
    progress_relpath   TEXT,
    log_relpath        TEXT,
    prompt_relpath     TEXT,
    run_status_relpath TEXT,
    exit_code          INTEGER,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ,
    reviewed_at        TIMESTAMPTZ,
    review_notes       TEXT,
    CONSTRAINT chk_dev_agent_task_runs_status
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'awaiting_review', 'canceled')),
    CONSTRAINT chk_dev_agent_task_runs_triggered_by
        CHECK (triggered_by IN ('queen', 'human', 'routine', 'manual'))
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_group_relations (
    id       SERIAL PRIMARY KEY,
    task_id  INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    group_id INTEGER     NOT NULL REFERENCES public.dev_agent_task_groups(id) ON DELETE CASCADE,
    created  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.dev_agent_task_todos (
    id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    task_id        INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    parent_todo_id BIGINT      REFERENCES public.dev_agent_task_todos(id) ON DELETE CASCADE,
    todo_text      TEXT        NOT NULL CHECK (char_length(todo_text) BETWEEN 1 AND 5000),
    status         TEXT        NOT NULL DEFAULT 'todo',
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    created_by     INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    completed_by   INTEGER     REFERENCES public.system_users(id) ON DELETE SET NULL,
    created        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed      TIMESTAMPTZ,
    CONSTRAINT ck_dev_agent_task_todos_parent_not_self
        CHECK (parent_todo_id IS NULL OR parent_todo_id <> id),
    CONSTRAINT fk_dev_agent_task_todos_status
        FOREIGN KEY (status) REFERENCES public.dev_agent_task_todo_statuses(slug) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.dev_agent_tasks_assets (
    id                 SERIAL PRIMARY KEY,
    dev_agent_tasks_id INTEGER     NOT NULL REFERENCES public.dev_agent_tasks(id) ON DELETE CASCADE,
    asset_kind         TEXT        NOT NULL DEFAULT 'image',
    filename           TEXT,
    original_name      TEXT,
    mime_type          TEXT,
    size_bytes         BIGINT,
    title              TEXT,
    description        TEXT,
    sort_order         INTEGER     NOT NULL DEFAULT 0,
    is_primary         BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata_json      JSONB,
    created            TIMESTAMPTZ DEFAULT now(),
    updated            TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_agent_task_queues_slug
    ON public.dev_agent_task_queues (slug);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status
    ON public.dev_agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_issue_type_status
    ON public.dev_agent_tasks (issue_type, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_parent_id
    ON public.dev_agent_tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_queue_id_status
    ON public.dev_agent_tasks (queue_id, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_status_priority
    ON public.dev_agent_tasks (status, priority);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_runs_task_id_started
    ON public.dev_agent_task_runs (task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_runs_status_started
    ON public.dev_agent_task_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_group_relations_group_id
    ON public.dev_agent_task_group_relations (group_id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_statuses_sort_order_slug
    ON public.dev_agent_task_statuses (sort_order, slug);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todo_statuses_sort_order_slug
    ON public.dev_agent_task_todo_statuses (sort_order, slug);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_task_tree
    ON public.dev_agent_task_todos (task_id, parent_todo_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_status
    ON public.dev_agent_task_todos (task_id, status);
CREATE INDEX IF NOT EXISTS idx_dev_agent_task_todos_parent
    ON public.dev_agent_task_todos (parent_todo_id) WHERE parent_todo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_parent
    ON public.dev_agent_tasks_assets (dev_agent_tasks_id);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_kind
    ON public.dev_agent_tasks_assets (asset_kind);
CREATE INDEX IF NOT EXISTS idx_dev_agent_tasks_assets_primary
    ON public.dev_agent_tasks_assets (dev_agent_tasks_id, is_primary, sort_order);

CREATE OR REPLACE FUNCTION public.set_dev_agent_tasks_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_queues_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_groups_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_statuses_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_todo_statuses_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.validate_dev_agent_task_todo_parent()
RETURNS TRIGGER AS $$
DECLARE
    parent_task_id INTEGER;
    parent_parent_id BIGINT;
BEGIN
    IF NEW.parent_todo_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT task_id, parent_todo_id
      INTO parent_task_id, parent_parent_id
      FROM public.dev_agent_task_todos
     WHERE id = NEW.parent_todo_id;

    IF parent_task_id IS NULL THEN
        RAISE EXCEPTION 'parent_todo_id % does not exist', NEW.parent_todo_id;
    END IF;
    IF parent_task_id <> NEW.task_id THEN
        RAISE EXCEPTION 'parent_todo_id % belongs to another task', NEW.parent_todo_id;
    END IF;
    IF parent_parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'dev_agent_task_todos supports only two levels';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_dev_agent_task_todos_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = now();
    IF NEW.status = 'done' THEN
        NEW.completed = COALESCE(NEW.completed, now());
    ELSE
        NEW.completed = NULL;
        NEW.completed_by = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_dev_agent_tasks_timestamp' AND tgrelid = 'public.dev_agent_tasks'::regclass) THEN
        CREATE TRIGGER update_dev_agent_tasks_timestamp
            BEFORE UPDATE ON public.dev_agent_tasks
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_tasks_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_queues_updated' AND tgrelid = 'public.dev_agent_task_queues'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_queues_updated
            BEFORE UPDATE ON public.dev_agent_task_queues
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_queues_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_groups_updated' AND tgrelid = 'public.dev_agent_task_groups'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_groups_updated
            BEFORE UPDATE ON public.dev_agent_task_groups
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_groups_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_statuses_updated' AND tgrelid = 'public.dev_agent_task_statuses'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_statuses_updated
            BEFORE UPDATE ON public.dev_agent_task_statuses
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_statuses_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_todo_statuses_updated' AND tgrelid = 'public.dev_agent_task_todo_statuses'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_todo_statuses_updated
            BEFORE UPDATE ON public.dev_agent_task_todo_statuses
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_todo_statuses_updated_timestamp();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_dev_agent_task_todo_parent' AND tgrelid = 'public.dev_agent_task_todos'::regclass) THEN
        CREATE TRIGGER validate_dev_agent_task_todo_parent
            BEFORE INSERT OR UPDATE ON public.dev_agent_task_todos
            FOR EACH ROW EXECUTE FUNCTION public.validate_dev_agent_task_todo_parent();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_dev_agent_task_todos_updated' AND tgrelid = 'public.dev_agent_task_todos'::regclass) THEN
        CREATE TRIGGER set_dev_agent_task_todos_updated
            BEFORE INSERT OR UPDATE ON public.dev_agent_task_todos
            FOR EACH ROW EXECUTE FUNCTION public.set_dev_agent_task_todos_timestamps();
    END IF;
END $$;

COMMENT ON TABLE public.dev_agent_tasks IS
    'Database-backed development tickets used by the shipped agent tools.';
COMMENT ON TABLE public.dev_agent_task_runs IS
    'Execution history linking development tickets to local worker artifacts.';
COMMENT ON TABLE public.dev_agent_task_todos IS
    'Structured, independently completable checklist rows for development tickets.';
