-- 20260919000009_seed_developer_workflow_metadata.sql
-- Seeds product-owned workflow vocabularies, table metadata, and interface labels.
-- Bridges the developer schema with generic dataset discovery and multilingual UI paths.
-- Exists so fresh installations work without inheriting any maintainer's ticket data.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

WITH desired(
    slug, lang_key, title, description, sort_order,
    is_active, is_terminal, is_claimable
) AS (
    VALUES
        ('new', 'dev_agent_task_status_new', 'New',
         'Work exists but has not yet been claimed and is ready for the active inbox.',
         10, TRUE, FALSE, TRUE),
        ('backlog', 'dev_agent_task_status_backlog', 'Backlog',
         'Work is intentionally parked outside the immediate inbox but remains claimable.',
         15, TRUE, FALSE, TRUE),
        ('backlog_later', 'dev_agent_task_status_backlog_later', 'Backlog / Later',
         'Work belongs in backlog and is explicitly deferred for later.',
         16, TRUE, FALSE, TRUE),
        ('backlog_nice_to_have', 'dev_agent_task_status_backlog_nice_to_have', 'Backlog / Nice To Have',
         'Work belongs in backlog and is intentionally marked as optional or lower-desirability.',
         17, TRUE, FALSE, TRUE),
        ('in_progress', 'dev_agent_task_status_in_progress', 'In Progress',
         'Work is actively being handled by a human or agent.',
         20, TRUE, FALSE, FALSE),
        ('on_hold', 'dev_agent_task_status_on_hold', 'On Hold',
         'Work is paused because of a blocker, timing issue, or dependency.',
         30, TRUE, FALSE, TRUE),
        ('awaiting_human_decision', 'dev_agent_task_status_awaiting_human_decision', 'Awaiting Human Decision',
         'Work is blocked until a human makes a real decision or approval.',
         40, TRUE, FALSE, FALSE),
        ('done', 'dev_agent_task_status_done', 'Done',
         'Work has been completed and accepted as finished.',
         50, FALSE, TRUE, FALSE),
        ('rejected', 'dev_agent_task_status_rejected', 'Rejected',
         'Work will not be pursued in its current form.',
         60, FALSE, TRUE, FALSE),
        ('aborted', 'dev_agent_task_status_aborted', 'Aborted',
         'Work was started and then intentionally stopped, superseded, or merged elsewhere before completion.',
         65, FALSE, TRUE, FALSE),
        ('archived', 'dev_agent_task_status_archived', 'Archived',
         'Work is intentionally kept only for historical reference.',
         70, FALSE, TRUE, FALSE),
        ('to_be_deleted', 'dev_agent_task_status_to_be_deleted', 'To Be Deleted',
         'Work is marked for deletion or cleanup after retention checks.',
         80, FALSE, TRUE, FALSE)
)
INSERT INTO public.dev_agent_task_statuses (
    slug, lang_key, title, description, sort_order,
    is_active, is_terminal, is_claimable
)
SELECT desired.slug, desired.lang_key, desired.title, desired.description,
       desired.sort_order, desired.is_active, desired.is_terminal, desired.is_claimable
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_statuses AS existing
    WHERE existing.slug = desired.slug
);

WITH desired(
    slug, lang_key, title, description, sort_order,
    is_completion_status, is_terminal
) AS (
    VALUES
        ('todo', 'dev_agent_task_todo_status_todo', 'Todo',
         'Work has not yet been verified as implemented.', 10, FALSE, FALSE),
        ('partially_done', 'dev_agent_task_todo_status_partially_done', 'Partially Done',
         'Some meaningful implementation exists, but the component is incomplete or too broad to close.',
         20, FALSE, FALSE),
        ('needs_review', 'dev_agent_task_todo_status_needs_review', 'Needs Review',
         'Implementation may exist, but the current evidence is not strong enough to mark it done.',
         30, FALSE, FALSE),
        ('not_applicable', 'dev_agent_task_todo_status_not_applicable', 'Not Applicable',
         'The component is intentionally outside the current product scope or does not fit this app model.',
         40, FALSE, TRUE),
        ('done', 'dev_agent_task_todo_status_done', 'Done',
         'Implementation exists and the todo can be treated as completed independently from the parent ticket.',
         50, TRUE, TRUE)
)
INSERT INTO public.dev_agent_task_todo_statuses (
    slug, lang_key, title, description, sort_order,
    is_completion_status, is_terminal
)
SELECT desired.slug, desired.lang_key, desired.title, desired.description,
       desired.sort_order, desired.is_completion_status, desired.is_terminal
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_todo_statuses AS existing
    WHERE existing.slug = desired.slug
);

WITH desired(slug, title, description, sort_order) AS (
    VALUES
        ('frontend', 'Frontend', 'Frontend UI and JavaScript work.', 10),
        ('backend', 'Backend', 'Go backend and API work.', 20),
        ('database', 'Database', 'Schema, migrations, and query work.', 30),
        ('security', 'Security', 'Security hardening, auth, and access control.', 40),
        ('stability', 'Stability', 'Reliability, error handling, and resilience.', 50),
        ('testing', 'Testing', 'Test coverage, E2E, and test infrastructure.', 60),
        ('documentation', 'Documentation', 'Docs, comments, and knowledge capture.', 70)
)
INSERT INTO public.dev_agent_task_groups (slug, title, description, sort_order)
SELECT desired.slug, desired.title, desired.description, desired.sort_order
FROM desired
WHERE NOT EXISTS (
    SELECT 1 FROM public.dev_agent_task_groups AS existing
    WHERE existing.slug = desired.slug
);

-- Add the final references to an older installation without rejecting legacy
-- rows. Clean installations validate each constraint immediately; an older
-- installation with an orphan keeps its row and receives a NOT VALID guard for
-- all new writes until that historical inconsistency is reviewed separately.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_dev_agent_tasks_issue_type'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT chk_dev_agent_tasks_issue_type
            CHECK (issue_type IN ('task', 'incident', 'bug', 'epic')) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dev_agent_tasks_parent_id_fkey'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT dev_agent_tasks_parent_id_fkey
            FOREIGN KEY (parent_id) REFERENCES public.dev_agent_tasks(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_tasks_queue_id'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT fk_dev_agent_tasks_queue_id
            FOREIGN KEY (queue_id) REFERENCES public.dev_agent_task_queues(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_tasks_status'
          AND conrelid = 'public.dev_agent_tasks'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_tasks
            ADD CONSTRAINT fk_dev_agent_tasks_status
            FOREIGN KEY (status) REFERENCES public.dev_agent_task_statuses(slug)
            ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_dev_agent_task_todos_status'
          AND conrelid = 'public.dev_agent_task_todos'::regclass
    ) THEN
        ALTER TABLE public.dev_agent_task_todos
            ADD CONSTRAINT fk_dev_agent_task_todos_status
            FOREIGN KEY (status) REFERENCES public.dev_agent_task_todo_statuses(slug)
            ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks
        WHERE issue_type NOT IN ('task', 'incident', 'bug', 'epic')
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT chk_dev_agent_tasks_issue_type;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS child
        WHERE child.parent_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.dev_agent_tasks AS parent WHERE parent.id = child.parent_id)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT dev_agent_tasks_parent_id_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS tasks
        WHERE tasks.queue_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.dev_agent_task_queues AS queues WHERE queues.id = tasks.queue_id)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT fk_dev_agent_tasks_queue_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_tasks AS tasks
        WHERE NOT EXISTS (SELECT 1 FROM public.dev_agent_task_statuses AS statuses WHERE statuses.slug = tasks.status)
    ) THEN
        ALTER TABLE public.dev_agent_tasks VALIDATE CONSTRAINT fk_dev_agent_tasks_status;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.dev_agent_task_todos AS todos
        WHERE NOT EXISTS (SELECT 1 FROM public.dev_agent_task_todo_statuses AS statuses WHERE statuses.slug = todos.status)
    ) THEN
        ALTER TABLE public.dev_agent_task_todos VALIDATE CONSTRAINT fk_dev_agent_task_todos_status;
    END IF;
END $$;

WITH desired(
    table_name, display_name, description, fk_display_column,
    filterbar_visible, sql_dump_policy, icon_key
) AS (
    VALUES
        ('dev_agent_tasks', 'Agent Tasks', 'Database-backed development tickets', 'title', TRUE, 'schema_only', 'task'),
        ('dev_agent_task_statuses', 'Agent Task Statuses', 'Workflow status registry for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_todo_statuses', 'Agent Task Todo Statuses', 'Status registry for structured ticket todos', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_queues', 'Agent Task Queues', 'Optional queue registry for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_groups', 'Agent Task Groups', 'Reusable classification groups for development tickets', 'title', FALSE, 'all', NULL),
        ('dev_agent_task_group_relations', 'Agent Task Group Relations', 'Links between development tickets and task groups', 'id', FALSE, 'schema_only', NULL),
        ('dev_agent_task_runs', 'Agent Task Runs', 'Local worker execution history for development tickets', 'run_id', FALSE, 'schema_only', NULL),
        ('dev_agent_task_todos', 'Agent Task Todos', 'Structured checklist rows for development tickets', 'todo_text', TRUE, 'schema_only', NULL),
        ('dev_agent_tasks_assets', 'Agent Task Assets', 'Images and attachments linked to development tickets', 'filename', FALSE, 'schema_only', NULL),
        ('dev_agent_worklines', 'Agent Worklines', 'Stable development workline identities', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_workline_reports', 'Agent Workline Reports', 'Immutable reports for development worklines', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_workline_tasks', 'Agent Workline Tasks', 'Optional links between worklines and tickets', 'id', TRUE, 'schema_only', NULL),
        ('dev_agent_handover_reports', 'Agent Handover Reports', 'Canonical handover manifests', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_handover_report_items', 'Agent Handover Report Items', 'Ordered report references in a handover', 'id', TRUE, 'schema_only', NULL),
        ('dev_agent_release_goals', 'Agent Release Goals', 'Versioned release decisions for worklines', 'title', TRUE, 'schema_only', NULL),
        ('dev_agent_release_goal_contracts', 'Agent Release Goal Contracts', 'Per-workline completion rules for a release goal', 'id', TRUE, 'schema_only', NULL)
)
INSERT INTO public.system_db_tables (
    table_name, description, cached_oid, schema_name, fk_display_column,
    filterbar_visible_by_default, is_removable, display_name,
    sql_dump_policy, icon_key
)
SELECT desired.table_name, desired.description, classes.oid::INTEGER, 'public',
       desired.fk_display_column, desired.filterbar_visible, FALSE,
       desired.display_name, desired.sql_dump_policy, desired.icon_key
FROM desired
JOIN pg_class AS classes ON classes.relname = desired.table_name
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_db_tables AS existing
    WHERE existing.table_name = desired.table_name
      AND COALESCE(NULLIF(existing.schema_name, ''), 'public') = 'public'
);

UPDATE public.system_db_tables AS metadata
SET cached_oid = classes.oid::INTEGER,
    updated = now()
FROM pg_class AS classes
JOIN pg_namespace AS schemas
  ON schemas.oid = classes.relnamespace AND schemas.nspname = 'public'
WHERE metadata.table_name = classes.relname
  AND metadata.table_name LIKE 'dev_agent_%'
  AND COALESCE(NULLIF(metadata.schema_name, ''), 'public') = 'public'
  AND metadata.cached_oid IS DISTINCT FROM classes.oid::INTEGER;

DO $$
DECLARE
    table_record RECORD;
    registered_table_uid INTEGER;
BEGIN
    FOR table_record IN
        SELECT table_name
        FROM public.system_db_tables
        WHERE table_name IN (
            'dev_agent_tasks',
            'dev_agent_task_statuses',
            'dev_agent_task_todo_statuses',
            'dev_agent_task_queues',
            'dev_agent_task_groups',
            'dev_agent_task_group_relations',
            'dev_agent_task_runs',
            'dev_agent_task_todos',
            'dev_agent_tasks_assets',
            'dev_agent_worklines',
            'dev_agent_workline_reports',
            'dev_agent_workline_tasks',
            'dev_agent_handover_reports',
            'dev_agent_handover_report_items',
            'dev_agent_release_goals',
            'dev_agent_release_goal_contracts'
        )
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
    LOOP
        SELECT table_uid INTO registered_table_uid
        FROM public.system_db_tables
        WHERE table_name = table_record.table_name
          AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
        LIMIT 1;

        INSERT INTO public.system_column_details (
            table_uid, column_name, data_type, co_number, created, updated
        )
        SELECT registered_table_uid, columns.column_name, columns.data_type,
               columns.ordinal_position, now(), now()
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = table_record.table_name
          AND NOT EXISTS (
              SELECT 1 FROM public.system_column_details AS existing
              WHERE existing.table_uid = registered_table_uid
                AND existing.column_name = columns.column_name
          )
        ORDER BY columns.ordinal_position;
    END LOOP;
END $$;

-- Reports, handovers, and release contracts are changed only through their
-- dedicated APIs; the generic table editor remains read-only for them.
UPDATE public.system_column_details AS details
SET editable_in_ui = FALSE,
    updated = now()
FROM public.system_db_tables AS tables
WHERE tables.table_uid = details.table_uid
  AND tables.table_name IN (
      'dev_agent_task_runs',
      'dev_agent_worklines',
      'dev_agent_workline_reports',
      'dev_agent_workline_tasks',
      'dev_agent_handover_reports',
      'dev_agent_handover_report_items',
      'dev_agent_release_goals',
      'dev_agent_release_goal_contracts'
  );

WITH authored(lang_key, fi, en, creation_spec) AS (
    VALUES
        ('dev_agent_tasks', 'Agentin tehtävät', 'Agent tasks', 'Database-tree label for development tickets.'),
        ('dev_agent_task_statuses', 'Agentin tehtävien tilat', 'Agent task statuses', 'Database-tree label for ticket statuses.'),
        ('dev_agent_task_todo_statuses', 'Agentin tehtävälistan tilat', 'Agent task todo statuses', 'Database-tree label for ticket todo statuses.'),
        ('dev_agent_task_queues', 'Agentin tehtäväjonot', 'Agent task queues', 'Database-tree label for ticket queues.'),
        ('dev_agent_task_groups', 'Agentin tehtäväryhmät', 'Agent task groups', 'Database-tree label for ticket groups.'),
        ('dev_agent_task_group_relations', 'Agentin tehtäväryhmien suhteet', 'Agent task group relations', 'Database-tree label for ticket group links.'),
        ('dev_agent_task_runs', 'Agentin tehtävien suoritukset', 'Agent task runs', 'Database-tree label for ticket run history.'),
        ('dev_agent_task_todos', 'Agentin tehtävän muistilista', 'Agent task todos', 'Database-tree label for structured ticket todos.'),
        ('dev_agent_tasks_assets', 'Agentin tehtävien liitteet', 'Agent task assets', 'Database-tree label for ticket assets.'),
        ('dev_agent_worklines', 'Agenttien työlinjat', 'Agent worklines', 'Database-tree label for stable development worklines.'),
        ('dev_agent_workline_reports', 'Agenttien työlinjaraportit', 'Agent workline reports', 'Database-tree label for workline reports.'),
        ('dev_agent_workline_tasks', 'Agenttien työlinjojen tiketit', 'Agent workline tasks', 'Database-tree label for workline ticket links.'),
        ('dev_agent_handover_reports', 'Agenttien handover-raportit', 'Agent handover reports', 'Database-tree label for handover reports.'),
        ('dev_agent_handover_report_items', 'Agenttien handover-raporttien kohdat', 'Agent handover report items', 'Database-tree label for handover items.'),
        ('dev_agent_release_goals', 'Agenttien julkaisutavoitteet', 'Agent release goals', 'Database-tree label for release goals.'),
        ('dev_agent_release_goal_contracts', 'Agenttien julkaisutavoitteiden ehdot', 'Agent release goal contracts', 'Database-tree label for release-goal contracts.'),
        ('workline_observatory', 'Työlinjojen tilannekuva', 'Workline observatory', 'Navigation label for the workline observatory.'),
        ('dev_agent_task_status_new', 'Uusi', 'New', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog', 'Backlog', 'Backlog', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog_later', 'Backlog / myöhemmin', 'Backlog / Later', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_backlog_nice_to_have', 'Backlog / kiva jos ehtii', 'Backlog / Nice To Have', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_in_progress', 'Työn alla', 'In Progress', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_on_hold', 'Tauolla', 'On Hold', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_awaiting_human_decision', 'Odottaa ihmisen päätöstä', 'Awaiting Human Decision', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_done', 'Valmis', 'Done', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_rejected', 'Hylätty', 'Rejected', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_aborted', 'Keskeytetty', 'Aborted', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_archived', 'Arkistoitu', 'Archived', 'Development-ticket workflow status.'),
        ('dev_agent_task_status_to_be_deleted', 'Poistettava', 'To Be Deleted', 'Development-ticket workflow status.'),
        ('dev_agent_task_todo_status_todo', 'Tekemättä', 'Todo', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_partially_done', 'Osittain tehty', 'Partially Done', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_needs_review', 'Tarkistettava', 'Needs Review', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_not_applicable', 'Ei sovellu', 'Not Applicable', 'Development-ticket todo status.'),
        ('dev_agent_task_todo_status_done', 'Valmis', 'Done', 'Development-ticket todo status.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT authored.lang_key, authored.fi, authored.en, authored.creation_spec
FROM authored
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_lang_keys AS existing
    WHERE existing.lang_key = authored.lang_key
);

WITH selected AS (
    SELECT id, fi, en
    FROM public.system_lang_keys
    WHERE lang_key LIKE 'dev_agent_%' OR lang_key = 'workline_observatory'
), authored AS (
    SELECT selected.id AS lang_key_id,
           translations.language_code,
           translations.translation
    FROM selected
    CROSS JOIN LATERAL (
        VALUES ('fi', selected.fi), ('en', selected.en)
    ) AS translations(language_code, translation)
    WHERE translations.translation IS NOT NULL
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id, language_code, translation, source_kind, review_status
)
SELECT authored.lang_key_id, authored.language_code, authored.translation,
       'manual', 'approved'
FROM authored
JOIN public.system_languages AS languages
  ON languages.language_code = authored.language_code
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_lang_key_translations AS existing
    WHERE existing.lang_key_id = authored.lang_key_id
      AND existing.language_code = authored.language_code
);

INSERT INTO public.system_lang_key_sources (
    lang_key_id, source_type, source_high, source_low,
    usage_explanation, last_seen
)
SELECT keys.id, 'schema', 'developer_workflow', keys.lang_key,
       'Developer ticket and workline database interface.', CURRENT_DATE
FROM public.system_lang_keys AS keys
WHERE (keys.lang_key LIKE 'dev_agent_%' OR keys.lang_key = 'workline_observatory')
  AND NOT EXISTS (
      SELECT 1 FROM public.system_lang_key_sources AS existing
      WHERE existing.lang_key_id = keys.id
        AND existing.source_type = 'schema'
        AND existing.source_high = 'developer_workflow'
  );

DO $$
DECLARE
    table_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readeronly') THEN
        FOREACH table_name IN ARRAY ARRAY[
            'dev_agent_tasks', 'dev_agent_task_statuses',
            'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_task_group_relations',
            'dev_agent_task_runs', 'dev_agent_task_todos',
            'dev_agent_tasks_assets', 'dev_agent_worklines',
            'dev_agent_workline_reports', 'dev_agent_workline_tasks',
            'dev_agent_handover_reports', 'dev_agent_handover_report_items',
            'dev_agent_release_goals', 'dev_agent_release_goal_contracts'
        ]
        LOOP
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO readeronly', table_name);
        END LOOP;
    END IF;
END $$;
