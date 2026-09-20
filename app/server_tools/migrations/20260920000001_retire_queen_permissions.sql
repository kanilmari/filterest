-- 20260920000001_retire_queen_permissions.sql
-- Removes Queen routes, grants, UI permission metadata and interface language rows.
-- Bridges the retired browser/backend surface with persisted permission metadata.
-- Exists so upgraded installations cannot retain discoverable Queen capabilities.
-- VERSION_DB: 9.8.0
-- VERSION_DB_OWNER: 20260919000010_record_developer_workflow_schema_release.sql

DELETE FROM public.system_group_table_func_rights
WHERE function_id IN (
    SELECT id
      FROM public.system_functions
     WHERE name IN (
            'devtools.QueenRunsHandler',
            'devtools.QueenSessionsHandler',
            'devtools.QueenSessionHandler',
            'devtools.QueenSessionMessageHandler',
            'devtools.QueenSessionStreamHandler',
            'devtools.QueenSessionStopHandler',
            'devtools.QueenTranscriptHandler',
            'devtools.QueenTranscriptStreamHandler',
            'agent_tools.BeeMessagesHandler',
            'ui.admin.queen_chat'
        )
        OR url_route_endpoint IN (
            '/api/queen/runs',
            '/api/queen/sessions',
            '/api/queen/session',
            '/api/queen/session/message',
            '/api/queen/session/stream',
            '/api/queen/session/stop',
            '/api/queen/transcript',
            '/api/queen/transcript/stream',
            '/api/app/bee/messages',
            '/ui/admin/queen_chat'
        )
);

DELETE FROM public.system_functions
WHERE name IN (
        'devtools.QueenRunsHandler',
        'devtools.QueenSessionsHandler',
        'devtools.QueenSessionHandler',
        'devtools.QueenSessionMessageHandler',
        'devtools.QueenSessionStreamHandler',
        'devtools.QueenSessionStopHandler',
        'devtools.QueenTranscriptHandler',
        'devtools.QueenTranscriptStreamHandler',
        'agent_tools.BeeMessagesHandler',
        'ui.admin.queen_chat'
    )
   OR url_route_endpoint IN (
        '/api/queen/runs',
        '/api/queen/sessions',
        '/api/queen/session',
        '/api/queen/session/message',
        '/api/queen/session/stream',
        '/api/queen/session/stop',
        '/api/queen/transcript',
        '/api/queen/transcript/stream',
        '/api/app/bee/messages',
        '/ui/admin/queen_chat'
    );

DELETE FROM public.system_lang_keys
WHERE lang_key IN (
    'queen_chat',
    'queen_chat_admin_description',
    'queen_chat_empty_state',
    'queen_managed_sessions',
    'queen_managed_sessions_description',
    'queen_runs_empty',
    'queen_sessions_empty',
    'queen_transcript_empty'
);
