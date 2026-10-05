-- row_actor_columns.schema.sql
-- Completes the creator and owner structure of the sixteen public content tables.
-- Bridges the common actor functions and the package's final schema, before seed rows
-- or privileges exist. Registration belongs to 000004 after groups and folders exist.
-- Exists so a fresh package needs no actor DDL in its data phase and its schema snapshot
-- is complete; upgrades and new datasets use these same physical helpers.
DO $actor_schema$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'palvelukatalogi', 'riskienhallinta', 'dokumentaatio', 'tiketit', 'system_about',
        'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
        'dev_agent_task_groups', 'dev_agent_tasks', 'dev_agent_task_todos', 'dev_agent_worklines',
        'dev_agent_workline_reports', 'dev_agent_handover_reports', 'dev_agent_release_goals',
        'dev_agent_release_goal_contracts'
    ] LOOP
        PERFORM public.app_ensure_row_actor_columns(format('public.%I', table_name)::regclass, 'owner_id');
        PERFORM public.app_ensure_row_actor_constraints(format('public.%I', table_name)::regclass, 'owner_id');
    END LOOP;
END $actor_schema$;
