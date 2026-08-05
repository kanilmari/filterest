import { describe, expect, test } from 'vitest';

import {
    buildDirectRunLatestHumanReply,
    getDirectRunOutcome,
    buildDirectRunProgressSummary,
    buildDirectRunProcessStatusSummary,
    buildDirectRunTurnSummary,
    buildManagedSessionPendingTurnMeta,
    buildManagedSessionPendingTurnSummary,
    buildQueenPublicThreadTimeline,
    buildQueenThreadSummaries,
    buildQueenContinuationPrompt,
    buildTerminalHandoffHint,
    buildQueenTranscriptSummary,
    canReplyToManagedSession,
    extractQueenPublicHumanText,
    formatQueenDisplayTimestamp,
    getQueenTranscriptDebugText,
    formatQueenTranscriptDisplayText,
    getQueenChatAuthFailure,
    getQueenComposerMode,
    isAwaitingHumanDirectRunTranscript,
    isQueenChatAuthStatus,
    isTerminalManagedSessionStatus,
    isTerminalDirectRunTranscript,
    shouldAutoCollapseQueenMessage,
    shouldDetachStaleDirectRunFollow,
    shouldAutoFollowManagedSession,
    shouldRefreshTerminalSessionTranscriptSnapshot,
} from './queen_chat_helpers.js';

describe('canReplyToManagedSession', () => {
    test('accepts awaiting_human sessions without a queued human follow-up', () => {
        expect(canReplyToManagedSession({
            status: 'awaiting_human',
            can_accept_human_followup: true,
            human_followup_queued: false,
        })).toBe(true);
    });

    test('rejects sessions that are already resuming', () => {
        expect(canReplyToManagedSession({
            status: 'resuming',
            can_accept_human_followup: false,
            human_followup_queued: true,
        })).toBe(false);
    });
});

describe('Queen chat auth failure helpers', () => {
    test('recognizes 401 and 403 as auth-related Queen chat failures', () => {
        expect(isQueenChatAuthStatus(401)).toBe(true);
        expect(isQueenChatAuthStatus('403')).toBe(true);
        expect(isQueenChatAuthStatus(404)).toBe(false);
    });

    test('builds a session-expired notice from a typed 401 error', () => {
        const error = new Error('Authentication required (401) for route: queenSessions');
        error.status = 401;

        expect(getQueenChatAuthFailure(error)).toEqual({
            status: 401,
            title: 'Queen chat session expired',
            detail: 'Queen chat lost its authenticated session. Re-login and then refresh this page before continuing.',
        });
    });

    test('detects a 403 auth loss from a pipeline-shaped message when status is absent', () => {
        expect(getQueenChatAuthFailure(
            new Error('Virhe pyynnössä (queenSessions): 403 - Forbidden'),
        )).toEqual({
            status: 403,
            title: 'Queen chat access lost',
            detail: 'Queen chat can no longer reach its protected endpoints. Your session may have expired, or your /ui/admin/queen_chat access may have changed in another tab. Re-login or refresh after access is restored.',
        });
    });

    test('ignores non-auth Queen chat errors', () => {
        expect(getQueenChatAuthFailure(new Error('Virhe pyynnössä (queenSessions): 500 - boom'))).toBeNull();
    });
});

describe('formatQueenDisplayTimestamp', () => {
    test('formats UTC ISO timestamps into Finland summer time with second precision', () => {
        expect(formatQueenDisplayTimestamp('2026-04-01T09:22:27.497521+00:00')).toBe('2026-04-01 12:22:27');
        expect(formatQueenDisplayTimestamp('2026-07-15T09:22:27Z')).toBe('2026-07-15 12:22:27');
    });

    test('formats UTC ISO timestamps into Finland winter time with second precision', () => {
        expect(formatQueenDisplayTimestamp('2026-01-15T09:22:27Z')).toBe('2026-01-15 11:22:27');
    });

    test('preserves already formatted second-precision timestamps', () => {
        expect(formatQueenDisplayTimestamp('2026-04-01 09:22:27')).toBe('2026-04-01 09:22:27');
    });

    test('supports custom blank fallbacks for message-level timestamps', () => {
        expect(formatQueenDisplayTimestamp('', '')).toBe('');
        expect(formatQueenDisplayTimestamp('', 'unknown time')).toBe('unknown time');
    });
});

describe('getQueenTranscriptDebugText', () => {
    test('returns the hidden debug transcript text when it differs from the visible text', () => {
        expect(getQueenTranscriptDebugText({
            role: 'controller',
            text: 'Start from Phase 1: Orient.',
            debug_full_text: 'Continue implementation from your existing session context.\n- Full internal prompt.',
        })).toBe('Continue implementation from your existing session context.\n- Full internal prompt.');
    });

    test('returns blank when there is no distinct debug transcript text', () => {
        expect(getQueenTranscriptDebugText({
            role: 'controller',
            text: 'Start from Phase 1: Orient.',
            debug_full_text: 'Start from Phase 1: Orient.',
        })).toBe('');
    });
});

describe('buildQueenTranscriptSummary', () => {
    test('builds controller summary chips and next-step note from the visible controller text', () => {
        expect(buildQueenTranscriptSummary({
            role: 'controller',
            text: [
                'Continue from Phase 3: Work Verbosely.',
                'End this reply no later than Phase 6: Close the Loop.',
                'Pacing: balanced.',
                'Next: Validate the manifest and write the final recommendation.',
            ].join('\n'),
        })).toEqual({
            chips: [
                { label: 'Phases 3 -> 6', tone: 'unknown' },
                { label: 'Pacing: balanced', tone: 'unknown' },
            ],
            note: 'Next: Validate the manifest and write the final recommendation.',
        });
    });

    test('builds QAP handoff summary chips and next-step note for Queen messages', () => {
        expect(buildQueenTranscriptSummary({
            role: 'queen',
            text: [
                'Completed the research pass.',
                '```json',
                JSON.stringify({
                    tyovaihe_alku: 'Phase 3: Work Verbosely',
                    tyovaihe_loppu: 'Phase 6: Close the Loop',
                    ehdotus_jatkoon: 'Implement the deployment manifest next.',
                    koodin_tila_vastaa_tavoitetta: true,
                    voidaanko_jatkaa: true,
                }),
                '```',
            ].join('\n'),
        })).toEqual({
            chips: [
                { label: 'Phases 3 -> 6', tone: 'unknown' },
                { label: 'Goal met', tone: 'completed' },
            ],
            note: 'Next: Implement the deployment manifest next.',
        });
    });

    test('prefers first-class transcript summary fields over parsing the message text', () => {
        expect(buildQueenTranscriptSummary({
            role: 'controller',
            text: 'Start from Phase 1: Orient.',
            summary_chips: [
                { label: 'Phases 1 -> 3', tone: 'unknown' },
                { label: 'Pacing: balanced', tone: 'unknown' },
            ],
            summary_note: 'Next: Keep the transcript summary structured.',
        })).toEqual({
            chips: [
                { label: 'Phases 1 -> 3', tone: 'unknown' },
                { label: 'Pacing: balanced', tone: 'unknown' },
            ],
            note: 'Next: Keep the transcript summary structured.',
        });
    });
});

describe('shouldAutoCollapseQueenMessage', () => {
    test('keeps the first and latest messages expanded while collapsing the middle ones', () => {
        expect(shouldAutoCollapseQueenMessage(0, 5)).toBe(false);
        expect(shouldAutoCollapseQueenMessage(1, 5)).toBe(true);
        expect(shouldAutoCollapseQueenMessage(3, 5)).toBe(true);
        expect(shouldAutoCollapseQueenMessage(4, 5)).toBe(false);
    });

    test('does not auto-collapse very short conversations', () => {
        expect(shouldAutoCollapseQueenMessage(0, 2)).toBe(false);
        expect(shouldAutoCollapseQueenMessage(1, 2)).toBe(false);
    });
});

describe('buildManagedSessionPendingTurnMeta', () => {
    test('summarizes the active in-flight agent turn for the progress rail', () => {
        expect(buildManagedSessionPendingTurnMeta({
            pending_turn: {
                agent_name: 'heisenberg',
                started_at: '2026-04-02T00:39:30Z',
                message_preview: 'Review the structured logging verification results first.',
            },
        })).toBe('Current turn: Heisenberg since 2026-04-02 03:39:30');
    });

    test('returns blank when there is no usable pending-turn telemetry', () => {
        expect(buildManagedSessionPendingTurnMeta({})).toBe('');
    });
});

describe('buildManagedSessionPendingTurnSummary', () => {
    test('renders a readable in-flight turn summary with the input preview', () => {
        expect(buildManagedSessionPendingTurnSummary({
            pending_turn: {
                agent_name: 'queen',
                started_at: '2026-04-02T00:41:00Z',
                message_preview: 'Human resume message from the browser-managed session: Please continue from the safer backend path.',
            },
        })).toContain('Queen is currently in-flight since 2026-04-02 03:41:00.');
    });

    test('falls back to a no-turn message when nothing is currently running', () => {
        expect(buildManagedSessionPendingTurnSummary(null)).toBe('No in-flight Queen or Heisenberg turn is currently recorded.');
    });
});

describe('buildDirectRunProgressSummary', () => {
    test('prefers direct-run runtime-state progress notes over transcript heuristics', () => {
        expect(buildDirectRunProgressSummary([
            { role: 'queen', text: 'Take the next step and report back.', timestamp: '2026-04-02T00:00:10Z' },
        ], true, {
            status: 'running',
            progress_tone: 'info',
            progress_note: 'Queen delegated the next step to Heisenberg.',
            progress_updated_at: '2026-04-02T00:00:12Z',
        })).toEqual({
            label: 'Queen delegated the next step to Heisenberg.',
            tone: 'running',
            spinning: true,
        });
    });

    test('marks a stalled direct run as not running when the Queen process is dead', () => {
        expect(buildDirectRunProgressSummary([
            { role: 'worker', text: 'Still working...', timestamp: '2026-04-02T00:00:15Z' },
        ], true, {
            status: 'running',
            process_id: 91234,
            process_alive: false,
            pending_turn: {
                agent_name: 'heisenberg',
                started_at: '2026-04-02T00:00:14Z',
                message_preview: 'Please keep going.',
            },
        })).toEqual({
            label: 'Queen process is not running (pid 91234)',
            tone: 'stopped',
            spinning: false,
        });
    });

    test('infers that Heisenberg is likely active after a Queen handoff while following live', () => {
        expect(buildDirectRunProgressSummary([
            { role: 'human', text: 'Investigate the failure.', timestamp: '2026-04-02T00:00:00Z' },
            { role: 'queen', text: 'Take the next step and report back.', timestamp: '2026-04-02T00:00:10Z' },
        ], true)).toEqual({
            label: 'Heisenberg is likely working on the next step.',
            tone: 'running',
            spinning: true,
        });
    });

    test('marks a direct run complete only when the latest Queen message carries the done signal', () => {
        expect(buildDirectRunProgressSummary([
            { role: 'worker', text: '[DONE] worker finished the task.', timestamp: '2026-04-02T00:00:15Z' },
        ], true)).toEqual({
            label: 'Queen is likely reviewing the latest worker result.',
            tone: 'running',
            spinning: true,
        });

        expect(buildDirectRunProgressSummary([
            { role: 'queen', text: '[DONE] Final answer for the user.', timestamp: '2026-04-02T00:00:20Z' },
        ], true, {
            status: 'completed',
            process_id: 91234,
            process_alive: false,
        })).toEqual({
            label: 'This direct Queen run is complete.',
            tone: 'completed',
            spinning: false,
        });
    });

    test('marks a direct run as awaiting human when the latest Queen message asks for input', () => {
        expect(buildDirectRunProgressSummary([
            { role: 'queen', text: '[AWAITING_HUMAN] Which rollout option should I take?', timestamp: '2026-04-02T00:01:00Z' },
        ], true)).toEqual({
            label: 'This direct Queen run is waiting for a human reply.',
            tone: 'awaiting_human',
            spinning: false,
        });
    });
});

describe('getDirectRunOutcome', () => {
    test('prefers runtime terminal states over transcript heuristics', () => {
        expect(getDirectRunOutcome([
            { role: 'queen', text: '[DONE] Final answer.', timestamp: '2026-04-02T00:03:00Z' },
        ], {
            status: 'awaiting_human',
        })).toEqual({
            label: 'AWAITING_HUMAN',
            tone: 'awaiting_human',
            source: 'runtime',
        });
    });

    test('falls back to transcript markers when runtime state is absent', () => {
        expect(getDirectRunOutcome([
            { role: 'queen', text: '[DONE] Final answer.', timestamp: '2026-04-02T00:03:00Z' },
        ])).toEqual({
            label: 'DONE',
            tone: 'completed',
            source: 'transcript',
        });
    });

    test('recognizes code-fenced QAP handoff completion without plain done markers', () => {
        expect(getDirectRunOutcome([
            {
                role: 'queen',
                text: [
                    'Verified the final slice.',
                    '',
                    '```json',
                    '{"koodin_tila_vastaa_tavoitetta": true, "voidaanko_jatkaa": true}',
                    '```',
                ].join('\n'),
                timestamp: '2026-04-02T00:03:30Z',
            },
        ])).toEqual({
            label: 'DONE',
            tone: 'completed',
            source: 'transcript',
        });
    });

    test('reports running when no terminal marker exists yet', () => {
        expect(getDirectRunOutcome([
            { role: 'worker', text: 'Still checking the repo.', timestamp: '2026-04-02T00:03:00Z' },
        ])).toEqual({
            label: 'RUNNING',
            tone: 'running',
            source: 'transcript',
        });
    });
});

describe('buildDirectRunTurnSummary', () => {
    test('uses direct-run pending-turn telemetry when it is available', () => {
        expect(buildDirectRunTurnSummary([], true, {
            status: 'running',
            pending_turn: {
                agent_name: 'heisenberg',
                started_at: '2026-04-02T00:02:30Z',
                message_preview: 'Investigate the failing browser observability path.',
            },
            })).toContain('Heisenberg is currently in-flight since 2026-04-02 03:02:30.');
    });

    test('includes worktree evidence for an in-flight direct run when runtime-state has touched files', () => {
        const summary = buildDirectRunTurnSummary([], true, {
            status: 'running',
            pending_turn: {
                agent_name: 'heisenberg',
                started_at: '2026-04-02T00:02:30Z',
                message_preview: 'Investigate the failing browser observability path.',
            },
            worktree_evidence: {
                captured_at: '2026-04-02T00:03:10Z',
                changed_path_count: 4,
                changed_paths: [
                    'server_tools/migrations/20260402000001_add_sql_dump_policy_to_system_db_tables.sql',
                    'server_tools/lib/sql_dump_policy.sh',
                    'server_tools/deploy_to_production.sh',
                ],
                summary: 'This turn has touched 4 repo files so far.',
            },
        });

        expect(summary).toContain('This turn has touched 4 repo files so far.');
        expect(summary).toContain('Files: server_tools/migrations/20260402000001_add_sql_dump_policy_to_system_db_tables.sql');
        expect(summary).toContain('+1 more');
    });

    test('describes a dead direct-run process in the session details rail', () => {
        expect(buildDirectRunTurnSummary([
            { role: 'worker', text: 'Still working...', timestamp: '2026-04-02T00:02:00Z' },
        ], true, {
            status: 'running',
            process_id: 91234,
            process_alive: false,
            pending_turn: {
                agent_name: 'heisenberg',
                started_at: '2026-04-02T00:02:30Z',
                message_preview: 'Investigate the failing browser observability path.',
            },
        })).toContain('Queen process is not running (pid 91234)');
    });

    test('describes the likely in-flight agent from the latest transcript role', () => {
        expect(buildDirectRunTurnSummary([
            { role: 'worker', text: 'I checked the audit results.', timestamp: '2026-04-02T00:02:00Z' },
        ], true)).toBe('Queen is likely in-flight since Heisenberg\'s latest message at 2026-04-02 03:02:00.');
    });

    test('reports terminal Queen and awaiting-human states explicitly', () => {
        expect(buildDirectRunTurnSummary([
            { role: 'queen', text: '[DONE] Final answer.', timestamp: '2026-04-02T00:03:00Z' },
        ], false)).toBe('Queen finished the run at 2026-04-02 03:03:00.');

        expect(buildDirectRunTurnSummary([
            { role: 'queen', text: '[AWAITING_HUMAN] Need your answer.', timestamp: '2026-04-02T00:04:00Z' },
        ], false)).toBe('Queen is waiting for a human reply since 2026-04-02 03:04:00.');
    });
});

describe('buildDirectRunLatestHumanReply', () => {
    test('returns the most recent human message from the direct run transcript', () => {
        expect(buildDirectRunLatestHumanReply([
            { role: 'human', text: 'Original prompt', timestamp: '2026-04-02T00:00:00Z' },
            { role: 'worker', text: 'Intermediate work', timestamp: '2026-04-02T00:00:10Z' },
            { role: 'human', text: 'Please continue from the safer path.', timestamp: '2026-04-02T00:00:20Z' },
        ])).toBe('Please continue from the safer path.');
    });
});

describe('direct-run terminal helpers', () => {
    test('recognize direct-run done and awaiting-human markers from the latest Queen entry only', () => {
        expect(isTerminalDirectRunTranscript([
            { role: 'worker', text: '[DONE] worker done first', timestamp: '2026-04-02T00:00:00Z' },
        ])).toBe(false);

        expect(isTerminalDirectRunTranscript([
            { role: 'queen', text: '{"status":"done"}', timestamp: '2026-04-02T00:00:10Z' },
        ])).toBe(true);

        expect(isAwaitingHumanDirectRunTranscript([
            { role: 'queen', text: '{"next_action":"await_human","question":"Continue?"}', timestamp: '2026-04-02T00:00:20Z' },
        ])).toBe(true);

        expect(isTerminalDirectRunTranscript([
            {
                role: 'queen',
                text: '```json\n{"koodin_tila_vastaa_tavoitetta": true, "voidaanko_jatkaa": true}\n```',
                timestamp: '2026-04-02T00:00:30Z',
            },
        ])).toBe(true);

        expect(isAwaitingHumanDirectRunTranscript([
            {
                role: 'queen',
                text: '```json\n{"koodin_tila_vastaa_tavoitetta": false, "voidaanko_jatkaa": false, "miksi_ei_voida_jatkaa": "Need your approval"}\n```',
                timestamp: '2026-04-02T00:00:40Z',
            },
        ])).toBe(true);
    });
});

describe('formatQueenTranscriptDisplayText', () => {
    test('strips trailing quick-action lists from terminal queen messages only in condensed mode', () => {
        const text = [
            '[DONE]',
            '',
            '**Summary**',
            '- **Ticket**: `#769`',
            '- **Phase**: 6. Close the Loop, Commit and Push',
            '',
            '01. Commit+push changes made in this chat',
            '02. Check worker/Queen status',
            '03. Proceed with AI\'s suggested next step(s)',
        ].join('\n');

        expect(formatQueenTranscriptDisplayText({
            role: 'queen',
            text,
        }, {
            condensed: true,
        })).toBe([
            '[DONE]',
            '',
            '**Summary**',
            '- **Ticket**: `#769`',
            '- **Phase**: 6. Close the Loop, Commit and Push',
        ].join('\n'));
    });

    test('keeps the full terminal queen message outside condensed mode', () => {
        const text = [
            '[DONE]',
            '',
            '**Summary**',
            '- **Ticket**: `#769`',
            '',
            '01. Commit+push changes made in this chat',
            '02. Check worker/Queen status',
        ].join('\n');

        expect(formatQueenTranscriptDisplayText({
            role: 'queen',
            text,
        })).toBe(text);
    });

    test('keeps quick-action lists on non-terminal messages', () => {
        const text = [
            'Intermediate note',
            '',
            '01. Commit+push changes made in this chat',
            '02. Check worker/Queen status',
        ].join('\n');

        expect(formatQueenTranscriptDisplayText({
            role: 'queen',
            text,
        })).toBe(text);
    });
});

describe('buildDirectRunProcessStatusSummary', () => {
    test('summarizes the Queen process alive state with the pid', () => {
        expect(buildDirectRunProcessStatusSummary({
            processAlive: true,
            processId: 4321,
        })).toBe('Queen process is alive (pid 4321)');
    });

    test('summarizes the Queen process dead state with the pid', () => {
        expect(buildDirectRunProcessStatusSummary({
            processAlive: false,
            processId: 4321,
        })).toBe('Queen process is not running (pid 4321)');
    });
});

describe('shouldDetachStaleDirectRunFollow', () => {
    test('detaches legacy direct-run follow when there is no runtime-state and transcript activity is stale', () => {
        expect(shouldDetachStaleDirectRunFollow({
            lastModifiedAt: '2026-04-02T07:49:56Z',
            lastEntryAt: '2026-04-02T07:49:56Z',
            runtimeState: null,
        }, '2026-04-02T07:50:20Z')).toBe(true);
    });

    test('keeps following when runtime-state exists even if the transcript itself is quiet', () => {
        expect(shouldDetachStaleDirectRunFollow({
            lastModifiedAt: '2026-04-02T07:49:56Z',
            lastEntryAt: '2026-04-02T07:49:56Z',
            runtimeState: {
                status: 'running',
                progress_updated_at: '2026-04-02T07:50:19Z',
            },
        }, '2026-04-02T07:50:20Z')).toBe(false);
    });

    test('keeps following when transcript activity is still recent', () => {
        expect(shouldDetachStaleDirectRunFollow({
            lastModifiedAt: '2026-04-02T07:49:56Z',
            lastEntryAt: '2026-04-02T07:49:56Z',
            runtimeState: null,
        }, '2026-04-02T07:50:05Z')).toBe(false);
    });
});

describe('getQueenComposerMode', () => {
    test('switches to new-session mode when the user starts a draft conversation', () => {
        expect(getQueenComposerMode({ newConversationDraft: true, selectedSession: null })).toBe('new_session');
    });

    test('returns reply_ready when the selected session is awaiting human input', () => {
        expect(getQueenComposerMode({
            newConversationDraft: false,
            selectedSession: {
                status: 'awaiting_human',
                can_accept_human_followup: true,
                human_followup_queued: false,
            },
        })).toBe('reply_ready');
    });

    test('returns session_locked when a session is selected but Queen is still working', () => {
        expect(getQueenComposerMode({
            newConversationDraft: false,
            selectedSession: {
                status: 'running',
                can_accept_human_followup: false,
                human_followup_queued: false,
            },
        })).toBe('session_locked');
    });

    test('returns continue_ready for a finished selected conversation', () => {
        expect(getQueenComposerMode({
            newConversationDraft: false,
            selectedRun: { filename: 'queen_run_demo.jsonl' },
            selectedSession: {
                status: 'completed',
                can_accept_human_followup: false,
                human_followup_queued: false,
            },
        })).toBe('continue_ready');
    });
});

describe('shouldAutoFollowManagedSession', () => {
    test('auto-follows active managed sessions', () => {
        expect(shouldAutoFollowManagedSession({ status: 'running' })).toBe(true);
        expect(shouldAutoFollowManagedSession({ status: 'awaiting_human' })).toBe(true);
    });

    test('does not auto-follow terminal sessions', () => {
        expect(shouldAutoFollowManagedSession({ status: 'completed' })).toBe(false);
        expect(shouldAutoFollowManagedSession({ status: 'failed' })).toBe(false);
    });
});

describe('isTerminalManagedSessionStatus', () => {
    test('recognizes managed-session terminal states', () => {
        expect(isTerminalManagedSessionStatus('completed')).toBe(true);
        expect(isTerminalManagedSessionStatus('failed')).toBe(true);
        expect(isTerminalManagedSessionStatus('stopped')).toBe(true);
    });

    test('rejects active managed-session states', () => {
        expect(isTerminalManagedSessionStatus('running')).toBe(false);
        expect(isTerminalManagedSessionStatus('awaiting_human')).toBe(false);
    });
});

describe('shouldRefreshTerminalSessionTranscriptSnapshot', () => {
    test('refreshes the selected transcript when a followed session reaches a terminal state', () => {
        expect(shouldRefreshTerminalSessionTranscriptSnapshot({
            status: 'completed',
            transcript_filename: 'queen_run_demo.jsonl',
        }, 'queen_run_demo.jsonl')).toBe(true);
    });

    test('does not refresh when the terminal session belongs to another transcript', () => {
        expect(shouldRefreshTerminalSessionTranscriptSnapshot({
            status: 'completed',
            transcript_filename: 'queen_run_other.jsonl',
        }, 'queen_run_demo.jsonl')).toBe(false);
    });

    test('does not refresh active sessions before completion', () => {
        expect(shouldRefreshTerminalSessionTranscriptSnapshot({
            status: 'running',
            transcript_filename: 'queen_run_demo.jsonl',
        }, 'queen_run_demo.jsonl')).toBe(false);
    });
});

describe('buildTerminalHandoffHint', () => {
    test('prefers queen run guidance while composing a new conversation', () => {
        expect(buildTerminalHandoffHint({ newConversationDraft: true })).toContain('./queen run');
    });

    test('shows the selected transcript filename for plain run browsing', () => {
        expect(buildTerminalHandoffHint({
            newConversationDraft: false,
            selectedRun: { filename: 'queen_run_demo.jsonl' },
            selectedSession: null,
        })).toContain('./queen chat queen_run_demo.jsonl');
    });

    test('shows attach and reply commands for awaiting-human sessions', () => {
        expect(buildTerminalHandoffHint({
            newConversationDraft: false,
            selectedSession: { id: 'qs_demo', status: 'awaiting_human' },
        })).toContain('./queen reply qs_demo');
    });
});

describe('buildQueenContinuationPrompt', () => {
    test('folds the selected transcript into a new continuation prompt', () => {
        const prompt = buildQueenContinuationPrompt({
            selectedRun: { filename: 'queen_run_demo.jsonl' },
            currentTranscriptEntries: [
                { turn: 1, role: 'human', agent: 'human', text: 'Investigate the broken import flow.' },
                { turn: 2, role: 'queen', agent: 'queen', text: 'I found the failing import boundary and proposed a fix.' },
            ],
        }, 'Continue from the fix plan and focus on the safer path.');

        expect(prompt).toContain('Continue a previous Queen conversation in a new managed session.');
        expect(prompt).toContain('answer directly in one short Queen reply');
        expect(prompt).toContain('do not delegate to Heisenberg');
        expect(prompt).toContain('Do not repeat old quick-action lists');
        expect(prompt).toContain('Previous conversation: queen_run_demo.jsonl');
        expect(prompt).toContain('[turn 2] queen (queen): I found the failing import boundary and proposed a fix.');
        expect(prompt).toContain('Continue from the fix plan and focus on the safer path.');
    });

    test('falls back to the raw message when there is no transcript context', () => {
        expect(buildQueenContinuationPrompt({ currentTranscriptEntries: [] }, 'Just start fresh.')).toBe('Just start fresh.');
    });
});

describe('extractQueenPublicHumanText', () => {
    test('extracts the real follow-up from a synthesized continuation prompt', () => {
        const text = [
            'Continue a previous Queen conversation in a new managed session.',
            'Transcript excerpt (chronological):',
            '[turn 1] human (human): Hello',
            'New human follow-up:',
            'Please repeat the shorter answer only.',
        ].join('\n\n');

        expect(extractQueenPublicHumanText(text)).toBe('Please repeat the shorter answer only.');
    });

    test('falls back to the raw text for ordinary human messages', () => {
        expect(extractQueenPublicHumanText('Summarize the current state briefly.')).toBe('Summarize the current state briefly.');
    });
});

describe('buildQueenThreadSummaries', () => {
    test('groups multiple runs under one persistent thread id', () => {
        const threads = buildQueenThreadSummaries([
            {
                filename: 'queen_run_a.jsonl',
                timestamp: '2026-04-01 09:00:00',
                task_id: 'manual',
                thread_id: 'qt_demo',
                thread_title: 'Investigate login flow',
            },
            {
                filename: 'queen_run_b.jsonl',
                timestamp: '2026-04-01 09:05:00',
                task_id: 'manual',
                thread_id: 'qt_demo',
                thread_title: 'Investigate login flow',
            },
        ], []);

        expect(threads).toHaveLength(1);
        expect(threads[0].threadId).toBe('qt_demo');
        expect(threads[0].runCount).toBe(2);
        expect(threads[0].latestRun.filename).toBe('queen_run_b.jsonl');
    });

    test('creates a singleton synthetic thread for a standalone run without thread metadata', () => {
        const threads = buildQueenThreadSummaries([
            {
                filename: 'queen_run_lonely.jsonl',
                timestamp: '2026-04-01 09:00:00',
                task_id: 'manual',
            },
        ], []);

        expect(threads).toHaveLength(1);
        expect(threads[0].persistent).toBe(false);
        expect(threads[0].key).toBe('run:queen_run_lonely.jsonl');
        expect(threads[0].title).toBe('queen_run_lonely.jsonl');
    });

    test('attaches an active managed session to the matching thread', () => {
        const threads = buildQueenThreadSummaries([
            {
                filename: 'queen_run_demo.jsonl',
                timestamp: '2026-04-01 09:00:00',
                task_id: 'manual',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
        ], [
            {
                id: 'qs_demo',
                status: 'running',
                updated_at: '2026-04-01T09:02:00Z',
                transcript_filename: 'queen_run_demo.jsonl',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
        ]);

        expect(threads).toHaveLength(1);
        expect(threads[0].activeSession.id).toBe('qs_demo');
        expect(threads[0].latestRun.filename).toBe('queen_run_demo.jsonl');
    });

    test('tracks the latest terminal session separately from the active session', () => {
        const threads = buildQueenThreadSummaries([
            {
                filename: 'queen_run_demo_a.jsonl',
                timestamp: '2026-04-01 09:00:00',
                task_id: 'manual',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
            {
                filename: 'queen_run_demo_b.jsonl',
                timestamp: '2026-04-01 09:10:00',
                task_id: 'manual',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
        ], [
            {
                id: 'qs_active',
                status: 'running',
                updated_at: '2026-04-01T09:02:00Z',
                transcript_filename: 'queen_run_demo_a.jsonl',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
            {
                id: 'qs_completed',
                status: 'completed',
                updated_at: '2026-04-01T09:12:00Z',
                transcript_filename: 'queen_run_demo_b.jsonl',
                thread_id: 'qt_demo',
                thread_title: 'Conversation demo',
            },
        ]);

        expect(threads).toHaveLength(1);
        expect(threads[0].activeSession.id).toBe('qs_active');
        expect(threads[0].latestSession.id).toBe('qs_completed');
    });
});

describe('buildQueenPublicThreadTimeline', () => {
    test('shows only the public human follow-up and final queen answer for a worker-backed continuation run', () => {
        const runs = [
            {
                filename: 'queen_run_demo.jsonl',
                timestamp: '2026-04-01 09:00:00',
            },
        ];
        const transcriptEntriesByFilename = {
            'queen_run_demo.jsonl': [
                {
                    role: 'human',
                    text: [
                        'Continue a previous Queen conversation in a new managed session.',
                        'Transcript excerpt (chronological):',
                        '[turn 2] queen (queen): Earlier answer',
                        'New human follow-up:',
                        'Repeat the shorter answer only.',
                    ].join('\n\n'),
                    timestamp: '2026-04-01T09:00:00Z',
                },
                {
                    role: 'queen',
                    text: 'Internal delegation note to worker.',
                    timestamp: '2026-04-01T09:00:05Z',
                },
                {
                    role: 'worker',
                    text: 'Worker scratchpad',
                    timestamp: '2026-04-01T09:00:10Z',
                },
                {
                    role: 'queen',
                    text: '[DONE] Repeat the shorter answer only: Easelect is a multilingual low-code app/database platform.',
                    timestamp: '2026-04-01T09:00:20Z',
                },
            ],
        };

        const timeline = buildQueenPublicThreadTimeline(runs, transcriptEntriesByFilename);

        expect(timeline).toHaveLength(2);
        expect(timeline[0].role).toBe('human');
        expect(timeline[0].text).toBe('Repeat the shorter answer only.');
        expect(timeline[1].role).toBe('queen');
        expect(timeline[1].text).toContain('Easelect is a multilingual low-code app/database platform.');
    });

    test('can include internal queen and worker turns in the public thread when explicitly requested', () => {
        const runs = [
            {
                filename: 'queen_run_demo.jsonl',
                timestamp: '2026-04-01 09:00:00',
            },
        ];
        const transcriptEntriesByFilename = {
            'queen_run_demo.jsonl': [
                {
                    role: 'human',
                    text: [
                        'Continue a previous Queen conversation in a new managed session.',
                        'Transcript excerpt (chronological):',
                        '[turn 2] queen (queen): Earlier answer',
                        'New human follow-up:',
                        'Repeat the shorter answer only.',
                    ].join('\n\n'),
                    timestamp: '2026-04-01T09:00:00Z',
                },
                {
                    role: 'queen',
                    agent: 'queen',
                    text: 'Internal delegation note to worker.',
                    timestamp: '2026-04-01T09:00:05Z',
                },
                {
                    role: 'worker',
                    agent: 'heisenberg',
                    text: 'Worker scratchpad',
                    timestamp: '2026-04-01T09:00:10Z',
                },
                {
                    role: 'queen',
                    text: '[DONE] Repeat the shorter answer only: Easelect is a multilingual low-code app/database platform.',
                    timestamp: '2026-04-01T09:00:20Z',
                },
            ],
        };

        const timeline = buildQueenPublicThreadTimeline(runs, transcriptEntriesByFilename, {
            includeInternalAgentTurns: true,
        });

        expect(timeline).toHaveLength(4);
        expect(timeline[0]).toMatchObject({ role: 'human', text: 'Repeat the shorter answer only.' });
        expect(timeline[1]).toMatchObject({ role: 'queen', internal: true, text: 'Internal delegation note to worker.' });
        expect(timeline[2]).toMatchObject({ role: 'worker', internal: true, agent: 'heisenberg', text: 'Worker scratchpad' });
        expect(timeline[3]).toMatchObject({ role: 'queen', tone: 'completed' });
    });

    test('preserves controller debug text when internal turns are included', () => {
        const timeline = buildQueenPublicThreadTimeline(
            [{ filename: 'queen_run_controller.jsonl', timestamp: '2026-04-01 09:00:00' }],
            {
                'queen_run_controller.jsonl': [
                    {
                        role: 'human',
                        text: 'Investigate the controller visibility.',
                        timestamp: '2026-04-01T09:00:00Z',
                    },
                    {
                        role: 'controller',
                        agent: 'QAP controller',
                        text: 'Continue from Phase 3: Work Verbosely.',
                        debug_full_text: 'Continue implementation from your existing session context.\n- Full internal prompt.',
                        summary_chips: [{ label: 'Phases 3 -> 6', tone: 'unknown' }],
                        summary_note: 'Next: Validate the manifest.',
                        timestamp: '2026-04-01T09:00:05Z',
                    },
                ],
            },
            {
                includeInternalAgentTurns: true,
            },
        );

        expect(timeline).toHaveLength(2);
        expect(timeline[1]).toMatchObject({
            role: 'controller',
            internal: true,
            text: 'Continue from Phase 3: Work Verbosely.',
            debug_full_text: 'Continue implementation from your existing session context.\n- Full internal prompt.',
            summary_chips: [{ label: 'Phases 3 -> 6', tone: 'unknown' }],
            summary_note: 'Next: Validate the manifest.',
        });
    });

    test('preserves meaningful line breaks in public queen replies', () => {
        const timeline = buildQueenPublicThreadTimeline(
            [{ filename: 'queen_run_multiline.jsonl', timestamp: '2026-04-01 09:00:00' }],
            {
                'queen_run_multiline.jsonl': [
                    {
                        role: 'human',
                        text: 'Summarize the fetch change.',
                        timestamp: '2026-04-01T09:00:00Z',
                    },
                    {
                        role: 'queen',
                        text: [
                            '[DONE] Updated the fetch path.',
                            '',
                            'Changes:',
                            '- endpoint_data_fetcher.js now owns the request.',
                            '- filter_column_builder.js now calls the shared helper.',
                        ].join('\n'),
                        timestamp: '2026-04-01T09:00:10Z',
                    },
                ],
            },
        );

        expect(timeline[1].text).toContain('Updated the fetch path.\n\nChanges:');
        expect(timeline[1].text).toContain('\n- endpoint_data_fetcher.js now owns the request.');
    });

    test('keeps awaiting-human questions visible in the public thread', () => {
        const timeline = buildQueenPublicThreadTimeline(
            [{ filename: 'queen_run_waiting.jsonl', timestamp: '2026-04-01 09:10:00' }],
            {
                'queen_run_waiting.jsonl': [
                    { role: 'human', text: 'Which rollout path should we take?', timestamp: '2026-04-01T09:10:00Z' },
                    { role: 'queen', text: '[AWAITING_HUMAN] Pick either the safer staged rollout or the fast direct rollout.', timestamp: '2026-04-01T09:10:05Z' },
                ],
            },
        );

        expect(timeline).toHaveLength(2);
        expect(timeline[1].tone).toBe('awaiting_human');
        expect(timeline[1].text).toContain('Pick either the safer staged rollout');
    });

    test('falls back to the last queen reply when a direct queen-only run never delegated', () => {
        const timeline = buildQueenPublicThreadTimeline(
            [{ filename: 'queen_run_direct.jsonl', timestamp: '2026-04-01 09:20:00' }],
            {
                'queen_run_direct.jsonl': [
                    { role: 'human', text: 'Summarize this briefly.', timestamp: '2026-04-01T09:20:00Z' },
                    { role: 'queen', text: 'Easelect is a multilingual app/database platform.', timestamp: '2026-04-01T09:20:05Z' },
                ],
            },
        );

        expect(timeline).toHaveLength(2);
        expect(timeline[1].text).toBe('Easelect is a multilingual app/database platform.');
    });
});
