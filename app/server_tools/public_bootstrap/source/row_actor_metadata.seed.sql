-- row_actor_metadata.seed.sql
-- Gives the creator and owner columns this release adds to the development tables the
-- metadata an upgrade gives them: hidden on cards and in the filter panel, never
-- insertable or editable, with their own language keys.
-- Bridges the schema completion source, which adds the columns before any seed, and the
-- development metadata seed, which then describes every physical column generically.
-- Exists because a new installation must equal an upgraded one: on upgrade the data step
-- 000004 creates these rows itself. The six creator columns older than 9.10.0 keep the
-- row the development seed gives them, as they do on upgrade.
UPDATE public.system_column_details AS details
   SET card_element = 'hidden',
       insertable = FALSE,
       editable_in_ui = FALSE,
       hide_in_filter_panel = TRUE,
       show_value_on_card = TRUE,
       lang_key = details.column_name,
       creation_spec = CASE details.column_name WHEN 'created_by' THEN 'WL58 row creator' ELSE 'WL58 row owner' END,
       updated = now()
  FROM public.system_db_tables AS registry
 WHERE registry.table_uid = details.table_uid
   AND ((details.column_name = 'owner_id' AND registry.table_name IN (
            'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_tasks', 'dev_agent_task_todos', 'dev_agent_worklines',
            'dev_agent_workline_reports', 'dev_agent_handover_reports', 'dev_agent_release_goals',
            'dev_agent_release_goal_contracts'))
     OR (details.column_name = 'created_by' AND registry.table_name IN (
            'dev_agent_task_statuses', 'dev_agent_task_todo_statuses', 'dev_agent_task_queues',
            'dev_agent_task_groups', 'dev_agent_tasks')));
