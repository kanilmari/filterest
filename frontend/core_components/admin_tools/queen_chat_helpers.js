// queen_chat_helpers.js
// Shared presentation helpers for the Queen admin chat workspace.
// Bridges selected session/chat state with simple UI mode decisions and CLI hints.
// Exists to keep the browser view logic readable and unit-testable.

const LEGACY_DIRECT_RUN_STALE_FOLLOW_MS = 15000;
const QUEEN_CHAT_AUTH_STATUSES = new Set([401, 403]);

export function isQueenChatAuthStatus(status) {
    const normalized = Number.parseInt(String(status || ''), 10);
    return Number.isInteger(normalized) && QUEEN_CHAT_AUTH_STATUSES.has(normalized);
}

export function getQueenChatAuthFailure(error) {
    const status = extractQueenChatAuthStatus(error);
    if (!isQueenChatAuthStatus(status)) {
        return null;
    }

    if (status === 401) {
        return {
            status,
            title: 'Queen chat session expired',
            detail: 'Queen chat lost its authenticated session. Re-login and then refresh this page before continuing.',
        };
    }

    return {
        status,
        title: 'Queen chat access lost',
        detail: 'Queen chat can no longer reach its protected endpoints. Your session may have expired, or your /ui/admin/queen_chat access may have changed in another tab. Re-login or refresh after access is restored.',
    };
}

export function canReplyToManagedSession(session) {
    return Boolean(
        session &&
        session.status === 'awaiting_human' &&
        session.can_accept_human_followup !== false &&
        !session.human_followup_queued,
    );
}

export function formatQueenDisplayTimestamp(timestamp, fallback = 'unknown time') {
    const raw = String(timestamp || '').trim();
    if (raw === '') {
        return fallback;
    }

    const explicitSecondPrecision = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:(Z|[+-]\d{2}:\d{2}))?$/);
    if (explicitSecondPrecision) {
        if (explicitSecondPrecision[3]) {
            const helsinkiFormatted = formatQueenHelsinkiTimestamp(raw);
            if (helsinkiFormatted) {
                return helsinkiFormatted;
            }
        }
        return `${explicitSecondPrecision[1]} ${explicitSecondPrecision[2]}`;
    }

    return raw;
}

export function buildManagedSessionPendingTurnMeta(session) {
    const pendingTurn = normalizeManagedSessionPendingTurn(session);
    if (!pendingTurn) {
        return '';
    }
    return `Current turn: ${pendingTurn.agentLabel} since ${formatQueenDisplayTimestamp(pendingTurn.startedAt)}`;
}

export function buildManagedSessionPendingTurnSummary(session) {
    const pendingTurn = normalizeManagedSessionPendingTurn(session);
    if (!pendingTurn) {
        return 'No in-flight Queen or Heisenberg turn is currently recorded.';
    }

    const lines = [
        `${pendingTurn.agentLabel} is currently in-flight since ${formatQueenDisplayTimestamp(pendingTurn.startedAt)}.`,
    ];
    if (pendingTurn.messagePreview !== '') {
        lines.push(`Input preview: ${truncateQueenPreview(pendingTurn.messagePreview, 240)}`);
    }
    return lines.join('\n');
}

export function buildDirectRunProgressSummary(entries, following = false, runtimeSource = null) {
    const outcome = getDirectRunOutcome(entries, runtimeSource);
    if (['completed', 'awaiting_human', 'failed', 'stopped'].includes(outcome.tone)) {
        if (outcome.tone === 'completed') {
            return { label: 'This direct Queen run is complete.', tone: 'completed', spinning: false };
        }
        if (outcome.tone === 'awaiting_human') {
            return { label: 'This direct Queen run is waiting for a human reply.', tone: 'awaiting_human', spinning: false };
        }
        if (outcome.tone === 'failed') {
            return { label: 'This direct Queen run failed.', tone: 'failed', spinning: false };
        }
        return { label: 'This direct Queen run stopped.', tone: 'stopped', spinning: false };
    }

    const runtimeState = normalizeDirectRunRuntimeState(runtimeSource);
    if (runtimeState) {
        if (runtimeState.processAlive === false) {
            const processStatus = buildDirectRunProcessStatusSummary(runtimeState);
            return {
                label: processStatus || 'Queen process is not running.',
                tone: 'stopped',
                spinning: false,
            };
        }

        if (runtimeState.progressNote !== '') {
            const tone = normalizeDirectRunProgressTone(runtimeState.progressTone || runtimeState.status);
            return {
                label: runtimeState.progressNote,
                tone,
                spinning: isDirectRunLiveProgressTone(tone),
            };
        }

        if (runtimeState.pendingTurn) {
            return {
                label: `${runtimeState.pendingTurn.agentLabel} is currently in-flight.`,
                tone: 'running',
                spinning: true,
            };
        }
    }

    const latestEntry = findLatestDirectRunTranscriptEntry(entries);
    if (!latestEntry) {
        return following
            ? { label: 'Watching the direct Queen transcript live...', tone: 'running', spinning: true }
            : null;
    }

    const role = normalizeDirectRunRole(latestEntry.role);
    const text = String(latestEntry.text || '');
    if (role === 'queen' && hasQueenDoneSignal(text)) {
        return { label: 'This direct Queen run appears complete.', tone: 'completed', spinning: false };
    }
    if (role === 'queen' && hasQueenAwaitingHumanSignal(text)) {
        return { label: 'This direct Queen run is waiting for a human reply.', tone: 'awaiting_human', spinning: false };
    }
    if (!following) {
        return null;
    }

    switch (role) {
    case 'human':
        return { label: 'Queen is likely working on the next reply.', tone: 'running', spinning: true };
    case 'queen':
        return { label: 'Heisenberg is likely working on the next step.', tone: 'running', spinning: true };
    case 'worker':
        return { label: 'Queen is likely reviewing the latest worker result.', tone: 'running', spinning: true };
    default:
        return { label: 'Watching the direct Queen transcript live...', tone: 'running', spinning: true };
    }
}

export function buildDirectRunTurnSummary(entries, following = false, runtimeSource = null) {
    const runtimeState = normalizeDirectRunRuntimeState(runtimeSource);
    const latestEntry = findLatestDirectRunTranscriptEntry(entries);
    const runtimeTimestamp = formatQueenDisplayTimestamp(
        runtimeState?.progressUpdatedAt || runtimeState?.updatedAt || latestEntry?.timestamp || '',
        '',
    );
    if (runtimeState?.processAlive === false && !['completed', 'awaiting_human', 'failed', 'stopped'].includes(runtimeState?.status)) {
        const processStatus = buildDirectRunProcessStatusSummary(runtimeState);
        const lines = [processStatus || 'Queen process is not running.'];
        if (runtimeState.pendingTurn) {
            lines.push(
                `${runtimeState.pendingTurn.agentLabel} was the last recorded in-flight turn since ${formatQueenDisplayTimestamp(runtimeState.pendingTurn.startedAt)}.`,
            );
        } else if (runtimeTimestamp !== '') {
            lines.push(`Last runtime update was ${runtimeTimestamp}.`);
        }
        return lines.join('\n');
    }

    if (runtimeState?.pendingTurn) {
        const lines = [
            `${runtimeState.pendingTurn.agentLabel} is currently in-flight since ${formatQueenDisplayTimestamp(runtimeState.pendingTurn.startedAt)}.`,
        ];
        if (runtimeState.pendingTurn.messagePreview !== '') {
            lines.push(`Input preview: ${truncateQueenPreview(runtimeState.pendingTurn.messagePreview, 240)}`);
        }
        const worktreeLines = buildDirectRunWorktreeEvidenceLines(runtimeState?.worktreeEvidence);
        lines.push(...worktreeLines);
        return lines.join('\n');
    }

    if (runtimeState?.status === 'completed') {
        return runtimeTimestamp !== ''
            ? `Queen finished the run at ${runtimeTimestamp}.`
            : 'Queen finished the run.';
    }
    if (runtimeState?.status === 'awaiting_human') {
        return runtimeTimestamp !== ''
            ? `Queen is waiting for a human reply since ${runtimeTimestamp}.`
            : 'Queen is waiting for a human reply.';
    }
    if (runtimeState?.status === 'failed') {
        return runtimeTimestamp !== ''
            ? `This direct Queen run failed at ${runtimeTimestamp}.`
            : 'This direct Queen run failed.';
    }
    if (runtimeState?.status === 'stopped') {
        return runtimeTimestamp !== ''
            ? `This direct Queen run stopped at ${runtimeTimestamp}.`
            : 'This direct Queen run stopped.';
    }

    if (!latestEntry) {
        if (following) {
            return 'Watching the direct Queen transcript live. No completed Queen or Heisenberg turn has been recorded yet.';
        }
        return 'No in-flight Queen or Heisenberg turn is currently recorded.';
    }

    const role = normalizeDirectRunRole(latestEntry.role);
    const text = String(latestEntry.text || '');
    const timestamp = formatQueenDisplayTimestamp(latestEntry.timestamp);
    if (role === 'queen' && hasQueenDoneSignal(text)) {
        return `Queen finished the run at ${timestamp}.`;
    }
    if (role === 'queen' && hasQueenAwaitingHumanSignal(text)) {
        return `Queen is waiting for a human reply since ${timestamp}.`;
    }

    switch (role) {
    case 'human':
        return `Queen is likely in-flight since the latest human message at ${timestamp}.`;
    case 'queen':
        return `Heisenberg is likely in-flight since Queen's latest message at ${timestamp}.`;
    case 'worker':
        return `Queen is likely in-flight since Heisenberg's latest message at ${timestamp}.`;
    default:
        return `Latest transcript activity was recorded at ${timestamp}.`;
    }
}

export function buildDirectRunLatestHumanReply(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    for (let index = safeEntries.length - 1; index >= 0; index -= 1) {
        const entry = safeEntries[index];
        if (normalizeDirectRunRole(entry?.role) !== 'human') {
            continue;
        }
        const text = String(entry?.text || '').trim();
        if (text !== '') {
            return truncateQueenPreview(text, 280);
        }
    }
    return 'No human message has been recorded in this direct run yet.';
}

export function getDirectRunOutcome(entries, runtimeSource = null) {
    const runtimeState = normalizeDirectRunRuntimeState(runtimeSource);
    if (runtimeState?.status === 'completed') {
        return { label: 'DONE', tone: 'completed', source: 'runtime' };
    }
    if (runtimeState?.status === 'awaiting_human') {
        return { label: 'AWAITING_HUMAN', tone: 'awaiting_human', source: 'runtime' };
    }
    if (runtimeState?.status === 'failed') {
        return { label: 'FAILED', tone: 'failed', source: 'runtime' };
    }
    if (runtimeState?.status === 'stopped') {
        return { label: 'STOPPED', tone: 'stopped', source: 'runtime' };
    }

    const latestEntry = findLatestDirectRunTranscriptEntry(entries);
    if (normalizeDirectRunRole(latestEntry?.role) === 'queen') {
        const latestText = String(latestEntry?.text || '');
        if (hasQueenDoneSignal(latestText)) {
            return { label: 'DONE', tone: 'completed', source: 'transcript' };
        }
        if (hasQueenAwaitingHumanSignal(latestText)) {
            return { label: 'AWAITING_HUMAN', tone: 'awaiting_human', source: 'transcript' };
        }
    }

    return { label: 'RUNNING', tone: 'running', source: runtimeState ? 'runtime' : 'transcript' };
}

export function formatQueenTranscriptDisplayText(entry, options = {}) {
    const text = String(entry?.text || '');
    // Condensed transcript text is only for collapsed middle messages. Expanded
    // and always-open messages should show the raw transcript body end-to-end.
    if (options?.condensed !== true) {
        return text;
    }
    if (normalizeDirectRunRole(entry?.role) !== 'queen') {
        return text;
    }
    if (!hasQueenDoneSignal(text) && !hasQueenAwaitingHumanSignal(text)) {
        return text;
    }
    return stripTrailingQueenQuickActions(text);
}

export function getQueenTranscriptDebugText(entry) {
    const visibleText = String(entry?.text || '').trim();
    const debugText = String(entry?.debug_full_text || '').trim();
    if (debugText === '' || debugText === visibleText) {
        return '';
    }
    return debugText;
}

export function buildQueenTranscriptSummary(entry) {
    const role = normalizeQueenToken(entry?.role);
    const text = String(entry?.text || '').trim();
    const structuredSummary = normalizeQueenStructuredSummary(entry);
    if (structuredSummary) {
        return structuredSummary;
    }
    if (text === '') {
        return { chips: [], note: '' };
    }

    if (role === 'controller') {
        return buildQueenControllerSummary(text);
    }

    const handoff = parseQueenQapHandoff(text);
    if (handoff) {
        return buildQueenHandoffSummary(handoff);
    }

    if (String(entry?.tone || '').trim() === 'completed') {
        return {
            chips: [{ label: 'Completed', tone: 'completed' }],
            note: '',
        };
    }
    if (String(entry?.tone || '').trim() === 'awaiting_human') {
        return {
            chips: [{ label: 'Awaiting human', tone: 'awaiting_human' }],
            note: '',
        };
    }

    return { chips: [], note: '' };
}

export function shouldAutoCollapseQueenMessage(index, total) {
    const normalizedIndex = Number.parseInt(String(index), 10);
    const normalizedTotal = Number.parseInt(String(total), 10);
    if (!Number.isInteger(normalizedIndex) || !Number.isInteger(normalizedTotal)) {
        return false;
    }
    return normalizedTotal > 2 && normalizedIndex > 0 && normalizedIndex < (normalizedTotal - 1);
}

export function isAwaitingHumanDirectRunTranscript(entries) {
    const latestEntry = findLatestDirectRunTranscriptEntry(entries);
    return normalizeDirectRunRole(latestEntry?.role) === 'queen' && hasQueenAwaitingHumanSignal(String(latestEntry?.text || ''));
}

export function isTerminalDirectRunTranscript(entries) {
    const latestEntry = findLatestDirectRunTranscriptEntry(entries);
    return normalizeDirectRunRole(latestEntry?.role) === 'queen' && hasQueenDoneSignal(String(latestEntry?.text || ''));
}

export function shouldDetachStaleDirectRunFollow(directRunLive, nowValue = '') {
    if (!directRunLive || typeof directRunLive !== 'object') {
        return false;
    }
    if (normalizeDirectRunRuntimeState(directRunLive.runtimeState)) {
        return false;
    }

    const nowMs = parseQueenMomentMs(nowValue) ?? Date.now();
    const lastActivityMs = [
        parseQueenMomentMs(directRunLive.lastModifiedAt),
        parseQueenMomentMs(directRunLive.lastEntryAt),
    ].reduce((latest, current) => (current !== null && current > latest ? current : latest), 0);

    if (lastActivityMs <= 0 || nowMs < lastActivityMs) {
        return false;
    }
    return (nowMs - lastActivityMs) >= LEGACY_DIRECT_RUN_STALE_FOLLOW_MS;
}

function formatQueenHelsinkiTimestamp(raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Helsinki',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(parsed);

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!values.year || !values.month || !values.day || !values.hour || !values.minute || !values.second) {
        return '';
    }

    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function findLatestDirectRunTranscriptEntry(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    for (let index = safeEntries.length - 1; index >= 0; index -= 1) {
        const entry = safeEntries[index];
        if (entry && typeof entry === 'object') {
            return entry;
        }
    }
    return null;
}

function normalizeDirectRunRuntimeState(runtimeSource) {
    if (!runtimeSource || typeof runtimeSource !== 'object') {
        return null;
    }

    const status = String(runtimeSource.status || '').trim().toLowerCase();
    const statusReason = String(runtimeSource.status_reason || runtimeSource.reason || '').trim();
    const progressPhase = String(runtimeSource.progress_phase || '').trim();
    const progressTone = String(runtimeSource.progress_tone || '').trim();
    const progressNote = String(runtimeSource.progress_note || '').trim();
    const progressUpdatedAt = String(
        runtimeSource.progress_updated_at
        || runtimeSource.updated_at
        || '',
    ).trim();
    const processId = Number.parseInt(String(runtimeSource.process_id || 0), 10);
    const processAliveRaw = runtimeSource.process_alive;
    const processAlive = typeof processAliveRaw === 'boolean' ? processAliveRaw : null;
    const pendingTurn = normalizeDirectRunPendingTurn(runtimeSource.pending_turn);
    const worktreeEvidence = normalizeDirectRunWorktreeEvidence(runtimeSource.worktree_evidence);

    if (status === '' && statusReason === '' && progressPhase === '' && progressTone === '' && progressNote === '' && progressUpdatedAt === '' && processId <= 0 && processAlive === null && !pendingTurn && !worktreeEvidence) {
        return null;
    }

    return {
        status,
        statusReason,
        progressPhase,
        progressTone,
        progressNote,
        progressUpdatedAt,
        updatedAt: progressUpdatedAt,
        processId: Number.isNaN(processId) ? 0 : Math.max(0, processId),
        processAlive,
        pendingTurn,
        worktreeEvidence,
    };
}

export function buildDirectRunProcessStatusSummary(runtimeState) {
    const processAlive = runtimeState?.processAlive ?? runtimeState?.process_alive;
    if (typeof processAlive !== 'boolean') {
        return '';
    }

    const processId = Number.parseInt(String(runtimeState?.processId || runtimeState?.process_id || 0), 10);
    const pidSuffix = Number.isFinite(processId) && processId > 0 ? ` (pid ${processId})` : '';
    return processAlive
        ? `Queen process is alive${pidSuffix}`
        : `Queen process is not running${pidSuffix}`;
}

function normalizeDirectRunRole(role) {
    return String(role || '').trim().toLowerCase();
}

function normalizeDirectRunPendingTurn(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const agentName = String(payload.agent_name || '').trim();
    const startedAt = String(payload.started_at || '').trim();
    const messagePreview = String(payload.message_preview || '').replace(/\s+/g, ' ').trim();
    if (agentName === '' || startedAt === '') {
        return null;
    }

    return {
        agentLabel: formatManagedTurnAgentLabel(agentName),
        startedAt,
        messagePreview,
    };
}

function normalizeDirectRunWorktreeEvidence(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const capturedAt = String(payload.captured_at || '').trim();
    const changedPaths = Array.isArray(payload.changed_paths)
        ? payload.changed_paths
            .map((path) => String(path || '').trim())
            .filter((path) => path !== '')
        : [];
    const changedPathCountRaw = Number.parseInt(
        String(payload.changed_path_count || changedPaths.length || 0),
        10,
    );
    const changedPathCount = Number.isNaN(changedPathCountRaw) ? changedPaths.length : Math.max(0, changedPathCountRaw);
    const summary = String(payload.summary || '').trim();

    if (capturedAt === '' && changedPathCount <= 0 && changedPaths.length === 0 && summary === '') {
        return null;
    }

    return {
        capturedAt,
        changedPathCount,
        changedPaths,
        summary,
    };
}

function buildDirectRunWorktreeEvidenceLines(worktreeEvidence) {
    if (!worktreeEvidence) {
        return [];
    }

    const lines = [];
    if (worktreeEvidence.summary !== '') {
        const capturedSuffix = worktreeEvidence.capturedAt !== ''
            ? ` (${formatQueenDisplayTimestamp(worktreeEvidence.capturedAt)})`
            : '';
        lines.push(`${worktreeEvidence.summary}${capturedSuffix}`);
    }

    if (worktreeEvidence.changedPaths.length > 0) {
        let filesLine = `Files: ${truncateQueenPreview(worktreeEvidence.changedPaths.join(', '), 240)}`;
        const hiddenCount = Math.max(0, worktreeEvidence.changedPathCount - worktreeEvidence.changedPaths.length);
        if (hiddenCount > 0) {
            filesLine += `, +${hiddenCount} more`;
        }
        lines.push(filesLine);
    }
    return lines;
}

function normalizeDirectRunProgressTone(value) {
    const normalized = normalizeQueenToken(value);
    switch (normalized) {
    case 'info':
        return 'running';
    case 'warning':
        return 'awaiting_human';
    case 'success':
        return 'completed';
    case 'danger':
        return 'failed';
    default:
        return normalized || 'running';
    }
}

function isDirectRunLiveProgressTone(tone) {
    return ['starting', 'running', 'resuming'].includes(String(tone || '').trim());
}

function normalizeQueenToken(value) {
    return String(value || 'unknown')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'unknown';
}

function parseQueenMomentMs(value) {
    const raw = String(value || '').trim();
    if (raw === '') {
        return null;
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
}

function hasQueenDoneSignal(text) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    if (lower.includes('[done]') || lower.includes('[task complete]')) {
        return true;
    }
    const directive = extractTrailingQueenDirective(raw);
    if (!directive) {
        return false;
    }
    return (
        String(directive.next_action || '').trim().toLowerCase() === 'report_to_user'
        || String(directive.status || '').trim().toLowerCase() === 'done'
        || directive.koodin_tila_vastaa_tavoitetta === true
    );
}

function hasQueenAwaitingHumanSignal(text) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    if (lower.includes('[awaiting_human]') || lower.includes('[human_decision_required]')) {
        return true;
    }
    const directive = extractTrailingQueenDirective(raw);
    if (!directive) {
        return false;
    }
    return (
        ['await_human', 'awaiting_human', 'wait_for_human'].includes(String(directive.next_action || '').trim().toLowerCase())
        || String(directive.status || '').trim().toLowerCase() === 'awaiting_human'
        || directive.voidaanko_jatkaa === false
    );
}

function extractTrailingQueenDirective(text) {
    const raw = String(text || '');
    const fencedMatches = [...raw.matchAll(/```json\s*([\s\S]*?)```/ig)];
    for (let index = fencedMatches.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(fencedMatches[index][1].trim());
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch {
            // Ignore malformed fenced JSON and keep scanning for older candidates.
        }
    }
    const braceStart = raw.indexOf('{');
    if (braceStart < 0) {
        return null;
    }
    for (let end = raw.length - 1; end > braceStart; end -= 1) {
        if (raw[end] !== '}') {
            continue;
        }
        try {
            const parsed = JSON.parse(raw.slice(braceStart, end + 1));
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch {
            // Ignore malformed JSON fragments and keep scanning backwards.
        }
    }
    return null;
}

function stripTrailingQueenQuickActions(text) {
    const lines = String(text || '').split('\n');
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') {
        end -= 1;
    }
    if (end < 0) {
        return '';
    }

    let start = end;
    const quickActionPattern = /^\d{2}\.\s+\S/;
    while (start >= 0 && quickActionPattern.test(lines[start].trim())) {
        start -= 1;
    }
    const actionCount = end - start;
    if (actionCount < 2) {
        return String(text || '');
    }

    while (start >= 0 && lines[start].trim() === '') {
        start -= 1;
    }
    return lines.slice(0, start + 1).join('\n').replace(/\s+$/, '');
}

function normalizeManagedSessionPendingTurn(session) {
    const pendingTurn = session?.pending_turn;
    if (!pendingTurn || typeof pendingTurn !== 'object') {
        return null;
    }

    const agentName = String(pendingTurn.agent_name || '').trim();
    const startedAt = String(pendingTurn.started_at || '').trim();
    const messagePreview = String(pendingTurn.message_preview || '').replace(/\s+/g, ' ').trim();
    if (agentName === '' || startedAt === '') {
        return null;
    }

    return {
        agentLabel: formatManagedTurnAgentLabel(agentName),
        startedAt,
        messagePreview,
    };
}

function formatManagedTurnAgentLabel(agentName) {
    const normalized = String(agentName || '')
        .trim()
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ');
    if (normalized === '') {
        return 'Unknown';
    }
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateQueenPreview(text, maxLength) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return normalized.slice(0, maxLength - 1) + '…';
}

export function buildQueenThreadSummaries(runs, sessions) {
    const threadMap = new Map();
    const safeRuns = Array.isArray(runs) ? runs : [];
    const safeSessions = Array.isArray(sessions) ? sessions : [];

    safeRuns.forEach((run) => {
        const key = buildQueenThreadKeyFromRun(run);
        const existing = threadMap.get(key) || createQueenThreadSummary(key, run?.thread_id || '', run?.thread_title || '', run);
        existing.title = existing.title || buildQueenThreadTitle(run?.thread_title, run);
        existing.runCount += 1;
        existing.runFilenames.push(String(run?.filename || ''));
        if (isNewerQueenMoment(run?.timestamp, existing.latestTimestampRaw)) {
            existing.latestTimestampRaw = String(run?.timestamp || '');
            existing.latestRun = run;
        }
        threadMap.set(key, existing);
    });

    safeSessions.forEach((session) => {
        const key = buildQueenThreadKeyFromSession(session);
        const existing = threadMap.get(key) || createQueenThreadSummary(key, session?.thread_id || '', session?.thread_title || '', null);
        existing.title = existing.title || buildQueenThreadTitle(session?.thread_title, session);
        const sessionMoment = String(session?.updated_at || session?.created_at || '');
        if (
            !existing.latestSession ||
            isNewerQueenMoment(sessionMoment, existing.latestSession?.updated_at || existing.latestSession?.created_at || '')
        ) {
            existing.latestSession = session;
        }
        if (
            shouldAutoFollowManagedSession(session) &&
            (
                !existing.activeSession ||
                isNewerQueenMoment(sessionMoment, existing.activeSession?.updated_at || existing.activeSession?.created_at || '')
            )
        ) {
            existing.activeSession = session;
        }
        existing.threadId = existing.threadId || String(session?.thread_id || '');
        existing.persistent = existing.persistent || Boolean(existing.threadId);
        if (isNewerQueenMoment(sessionMoment, existing.latestTimestampRaw)) {
            existing.latestTimestampRaw = sessionMoment;
        }
        if (!existing.latestRun && session?.transcript_filename) {
            existing.latestRun = {
                filename: session.transcript_filename,
                timestamp: session.created_at || '',
                task_id: session.task_id ?? 'manual',
                thread_id: session.thread_id || '',
                thread_title: session.thread_title || '',
                thread_runs: existing.runCount || 1,
                message_count: 0,
                roles: [],
            };
        }
        threadMap.set(key, existing);
    });

    return Array.from(threadMap.values())
        .map((thread) => ({
            ...thread,
            runCount: thread.runCount || thread.runFilenames.filter((filename) => filename).length || 1,
            title: thread.title || 'Queen conversation',
        }))
        .sort((left, right) => compareQueenMoments(right.latestTimestampRaw, left.latestTimestampRaw));
}

export function getQueenComposerMode(chatState) {
    if (chatState?.newConversationDraft) {
        return 'new_session';
    }
    if (canReplyToManagedSession(chatState?.selectedSession)) {
        return 'reply_ready';
    }
    if (chatState?.selectedSession?.human_followup_queued) {
        return 'reply_queued';
    }
    if (
        chatState?.selectedRun &&
        (!chatState?.selectedSession || !shouldAutoFollowManagedSession(chatState.selectedSession))
    ) {
        return 'continue_ready';
    }
    if (chatState?.selectedSession) {
        return 'session_locked';
    }
    return 'idle';
}

export function shouldAutoFollowManagedSession(session) {
    return ['running', 'awaiting_human', 'resuming', 'starting', 'stopping'].includes(String(session?.status || ''));
}

export function isTerminalManagedSessionStatus(status) {
    return ['completed', 'failed', 'stopped'].includes(String(status || ''));
}

export function shouldRefreshTerminalSessionTranscriptSnapshot(session, selectedRunFilename) {
    const transcriptFilename = String(session?.transcript_filename || '').trim();
    const selectedFilename = String(selectedRunFilename || '').trim();
    return (
        isTerminalManagedSessionStatus(session?.status) &&
        transcriptFilename !== '' &&
        transcriptFilename === selectedFilename
    );
}

export function buildTerminalHandoffHint(chatState) {
    const selectedSession = chatState?.selectedSession || null;
    const selectedRun = chatState?.selectedRun || null;
    if (chatState?.newConversationDraft) {
        return 'Terminal handoff: ./queen run "Describe what Queen should work on..."';
    }
    if (selectedRun?.filename && !selectedSession?.id) {
        return `Terminal handoff: ./queen chat ${selectedRun.filename}`;
    }
    if (!selectedSession?.id) {
        return 'Terminal handoff: ./queen chat --sessions';
    }
    const attachCommand = shouldAutoFollowManagedSession(selectedSession)
        ? `./queen chat --session ${selectedSession.id} --follow`
        : `./queen chat --session ${selectedSession.id}`;
    if (selectedSession.status === 'awaiting_human') {
        return `Terminal handoff: ${attachCommand} · reply with ./queen reply ${selectedSession.id} "..."`;
    }
    return `Terminal handoff: ${attachCommand}`;
}

export function buildQueenContinuationPrompt(chatState, userMessage) {
    const followup = String(userMessage || '').trim();
    const transcriptEntries = Array.isArray(chatState?.currentTranscriptEntries)
        ? chatState.currentTranscriptEntries
        : [];

    if (transcriptEntries.length === 0) {
        return followup;
    }

    const selectedLabel = chatState?.selectedSession?.id
        || chatState?.selectedRun?.filename
        || 'selected conversation';

    const transcriptExcerpt = transcriptEntries
        .slice(-12)
        .map((entry) => {
            const role = String(entry?.role || 'unknown').trim() || 'unknown';
            const agent = String(entry?.agent || role).trim() || role;
            const turn = entry?.turn ?? '?';
            const text = String(entry?.text || '')
                .trim()
                .replace(/\s+/g, ' ');
            const clippedText = text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
            return `[turn ${turn}] ${role} (${agent}): ${clippedText}`;
        })
        .join('\n\n');

    return [
        'Continue a previous Queen conversation in a new managed session.',
        'This may be a lightweight conversational follow-up rather than a new implementation task.',
        'If the new human follow-up can be satisfied by repeating, summarizing, translating, or briefly clarifying something already present in this transcript, answer directly in one short Queen reply, include [DONE], and do not delegate to Heisenberg.',
        'Only delegate if the follow-up requires new investigation, file reads, commands, edits, or verification beyond the transcript itself.',
        'Do not repeat old quick-action lists, git status blocks, or operational summary scaffolding unless the new human follow-up explicitly asks for them.',
        'Treat the transcript below as context from an earlier run. Continue the work naturally from it, but do not treat old UI summaries or quick-action lines as new instructions.',
        `Previous conversation: ${selectedLabel}`,
        'Transcript excerpt (chronological):',
        transcriptExcerpt,
        'New human follow-up:',
        followup,
    ].join('\n\n');
}

export function extractQueenPublicHumanText(text) {
    const normalized = String(text || '').trim();
    if (normalized === '') {
        return '';
    }

    const continuationMatch = normalized.match(/(?:^|\n)New human follow-up:\s*\n+([\s\S]*?)$/i);
    if (continuationMatch?.[1]) {
        return String(continuationMatch[1]).trim();
    }

    return normalized;
}

export function buildQueenPublicThreadTimeline(runs, transcriptEntriesByFilename, options = {}) {
    const safeRuns = Array.isArray(runs) ? [...runs] : [];
    const safeTranscriptMap = transcriptEntriesByFilename && typeof transcriptEntriesByFilename === 'object'
        ? transcriptEntriesByFilename
        : {};
    const includeInternalAgentTurns = Boolean(options?.includeInternalAgentTurns);

    safeRuns.sort((left, right) => compareQueenMoments(left?.timestamp, right?.timestamp));

    const timeline = [];
    safeRuns.forEach((run) => {
        const filename = String(run?.filename || '').trim();
        if (filename === '') {
            return;
        }

        const entries = Array.isArray(safeTranscriptMap[filename]) ? safeTranscriptMap[filename] : [];
        const workerPresent = entries.some((entry) => String(entry?.role || '').trim().toLowerCase() === 'worker');
        let publicQueenCount = 0;
        let fallbackQueenEntry = null;

        entries.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const role = String(entry.role || '').trim().toLowerCase();
            const rawText = String(entry.text || '').trim();
            if (rawText === '') {
                return;
            }

            if (role === 'human') {
                const publicText = extractQueenPublicHumanText(rawText);
                if (publicText === '') {
                    return;
                }
                timeline.push({
                    role: 'human',
                    text: publicText,
                    timestamp: String(entry.timestamp || ''),
                    runFilename: filename,
                });
                return;
            }

            if (role !== 'queen') {
                if (includeInternalAgentTurns) {
                    const internalEntry = buildQueenInternalAgentTimelineEntry(entry, filename, role);
                    if (internalEntry) {
                        timeline.push(internalEntry);
                    }
                }
                return;
            }

            fallbackQueenEntry = entry;

            if (isQueenAwaitingHumanSignal(rawText)) {
                publicQueenCount += 1;
                timeline.push({
                    role: 'queen',
                    text: extractQueenAwaitingHumanReason(rawText),
                    summary_chips: Array.isArray(entry?.summary_chips) ? entry.summary_chips : undefined,
                    summary_note: String(entry?.summary_note || '').trim(),
                    timestamp: String(entry.timestamp || ''),
                    runFilename: filename,
                    tone: 'awaiting_human',
                });
                return;
            }

            if (isQueenDoneSignal(rawText)) {
                publicQueenCount += 1;
                timeline.push({
                    role: 'queen',
                    text: summarizeQueenDoneText(rawText),
                    summary_chips: Array.isArray(entry?.summary_chips) ? entry.summary_chips : undefined,
                    summary_note: String(entry?.summary_note || '').trim(),
                    timestamp: String(entry.timestamp || ''),
                    runFilename: filename,
                    tone: 'completed',
                });
                return;
            }

            if (includeInternalAgentTurns) {
                const internalQueenEntry = buildQueenInternalAgentTimelineEntry(entry, filename, role);
                if (internalQueenEntry) {
                    timeline.push(internalQueenEntry);
                }
            }
        });

        if (publicQueenCount === 0 && !workerPresent && !includeInternalAgentTurns && fallbackQueenEntry?.text) {
            timeline.push({
                role: 'queen',
                text: String(fallbackQueenEntry.text).trim(),
                summary_chips: Array.isArray(fallbackQueenEntry?.summary_chips) ? fallbackQueenEntry.summary_chips : undefined,
                summary_note: String(fallbackQueenEntry?.summary_note || '').trim(),
                timestamp: String(fallbackQueenEntry.timestamp || ''),
                runFilename: filename,
                tone: 'queen',
            });
        }
    });

    return timeline;
}

function buildQueenInternalAgentTimelineEntry(entry, runFilename, role) {
    const rawText = String(entry?.text || '').trim();
    if (rawText === '') {
        return null;
    }

    return {
        role: String(role || 'unknown').trim().toLowerCase() || 'unknown',
        agent: String(entry?.agent || role || '').trim(),
        text: rawText,
        debug_full_text: getQueenTranscriptDebugText(entry),
        summary_chips: Array.isArray(entry?.summary_chips) ? entry.summary_chips : undefined,
        summary_note: String(entry?.summary_note || '').trim(),
        timestamp: String(entry?.timestamp || ''),
        runFilename,
        tone: 'internal_agent_turn',
        internal: true,
        turn: entry?.turn ?? null,
    };
}

function createQueenThreadSummary(key, threadId, threadTitle, run) {
    return {
        key,
        threadId: String(threadId || ''),
        persistent: String(threadId || '').trim() !== '',
        title: buildQueenThreadTitle(threadTitle, run),
        latestRun: run || null,
        activeSession: null,
        latestSession: null,
        latestTimestampRaw: String(run?.timestamp || ''),
        runCount: 0,
        runFilenames: [],
    };
}

function buildQueenThreadKeyFromRun(run) {
    const persistentThreadID = String(run?.thread_id || '').trim();
    if (persistentThreadID !== '') {
        return persistentThreadID;
    }
    const filename = String(run?.filename || '').trim();
    return filename !== '' ? `run:${filename}` : 'run:unknown';
}

function buildQueenThreadKeyFromSession(session) {
    const persistentThreadID = String(session?.thread_id || '').trim();
    if (persistentThreadID !== '') {
        return persistentThreadID;
    }
    const filename = String(session?.transcript_filename || '').trim();
    if (filename !== '') {
        return `run:${filename}`;
    }
    const sessionID = String(session?.id || '').trim();
    return sessionID !== '' ? `session:${sessionID}` : 'session:unknown';
}

function buildQueenThreadTitle(threadTitle, fallbackSource) {
    const explicitTitle = String(threadTitle || '').trim();
    if (explicitTitle !== '') {
        return explicitTitle;
    }
    const promptPreview = String(fallbackSource?.prompt || '').trim();
    if (promptPreview !== '') {
        return promptPreview;
    }
    const filename = String(fallbackSource?.filename || fallbackSource?.transcript_filename || '').trim();
    if (filename !== '') {
        return filename;
    }
    return 'Queen conversation';
}

function normalizeQueenStructuredSummary(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const chips = (Array.isArray(entry.summary_chips) ? entry.summary_chips : [])
        .map((chip) => {
            const label = String(chip?.label || '').trim();
            if (label === '') {
                return null;
            }
            const tone = String(chip?.tone || 'unknown').trim() || 'unknown';
            return { label, tone };
        })
        .filter(Boolean);
    const note = String(entry.summary_note || '').trim();

    if (chips.length === 0 && note === '') {
        return null;
    }
    return { chips, note };
}

function isNewerQueenMoment(candidate, baseline) {
    return compareQueenMoments(candidate, baseline) > 0;
}

function compareQueenMoments(left, right) {
    return normalizeQueenMoment(left) - normalizeQueenMoment(right);
}

function normalizeQueenMoment(raw) {
    const value = String(raw || '').trim();
    if (value === '') return 0;

    const direct = Date.parse(value);
    if (Number.isFinite(direct)) {
        return direct;
    }

    const spaced = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    const parsed = Date.parse(spaced);
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return 0;
}

function isQueenAwaitingHumanSignal(text) {
    const lower = String(text || '').toLowerCase();
    return lower.includes('[awaiting_human]') || lower.includes('[human_decision_required]');
}

function isQueenDoneSignal(text) {
    const lower = String(text || '').toLowerCase();
    return lower.includes('[done]') || lower.includes('[task complete]');
}

function extractQueenAwaitingHumanReason(text) {
    const normalized = normalizeQueenMessageFormatting(
        String(text || '')
            .replace(/\[awaiting_human\]/ig, '')
            .replace(/\[human_decision_required\]/ig, ''),
    );
    return normalized || 'Queen is awaiting a human decision.';
}

function summarizeQueenDoneText(text) {
    const normalized = normalizeQueenMessageFormatting(
        String(text || '')
            .replace(/\[done\]/ig, '')
            .replace(/\[task complete\]/ig, ''),
    );
    return normalized || 'Queen completed the run.';
}

function normalizeQueenMessageFormatting(text) {
    const lines = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim());

    const collapsed = [];
    let previousWasBlank = false;
    lines.forEach((line) => {
        if (line === '') {
            if (!previousWasBlank) {
                collapsed.push('');
            }
            previousWasBlank = true;
            return;
        }
        collapsed.push(line);
        previousWasBlank = false;
    });

    return collapsed.join('\n').trim();
}

function buildQueenControllerSummary(text) {
    const lines = String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const startLine = lines.find((line) => /^start from /i.test(line) || /^continue from /i.test(line)) || '';
    const endLine = lines.find((line) => /^end this reply no later than /i.test(line)) || '';
    const pacingLine = lines.find((line) => /^pacing:/i.test(line)) || '';
    const nextLine = lines.find((line) => /^next:/i.test(line)) || '';

    const startPhase = extractQueenSummaryPhaseLabel(startLine);
    const endPhase = extractQueenSummaryPhaseLabel(endLine);
    const pacing = pacingLine.replace(/^pacing:\s*/i, '').replace(/\.$/, '').trim();
    const nextStep = nextLine.replace(/^next:\s*/i, '').trim();

    const chips = [];
    const phaseLabel = buildQueenPhaseWindowSummary(startPhase, endPhase);
    if (phaseLabel) {
        chips.push({ label: phaseLabel, tone: 'unknown' });
    }
    if (pacing !== '') {
        chips.push({ label: `Pacing: ${pacing}`, tone: 'unknown' });
    }

    return {
        chips,
        note: nextStep !== '' ? `Next: ${nextStep}` : '',
    };
}

function parseQueenQapHandoff(text) {
    const matches = String(text || '').match(/```json\s*([\s\S]*?)```/g);
    if (!matches || matches.length === 0) {
        return null;
    }

    const rawBlock = matches[matches.length - 1].replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(rawBlock);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
        return null;
    }
}

function buildQueenHandoffSummary(handoff) {
    const startPhase = String(handoff?.tyovaihe_alku || '').trim();
    const endPhase = String(handoff?.tyovaihe_loppu || '').trim();
    const nextStep = String(handoff?.ehdotus_jatkoon || '').trim();
    const goalMet = Boolean(handoff?.koodin_tila_vastaa_tavoitetta);
    const canContinue = handoff?.voidaanko_jatkaa !== false;

    const chips = [];
    const phaseLabel = buildQueenPhaseWindowSummary(startPhase, endPhase);
    if (phaseLabel) {
        chips.push({ label: phaseLabel, tone: 'unknown' });
    }

    if (goalMet) {
        chips.push({ label: 'Goal met', tone: 'completed' });
    } else if (!canContinue) {
        chips.push({ label: 'Awaiting human', tone: 'awaiting_human' });
    } else {
        chips.push({ label: 'In progress', tone: 'running' });
    }

    return {
        chips,
        note: nextStep !== '' ? `Next: ${nextStep}` : '',
    };
}

function extractQueenSummaryPhaseLabel(text) {
    const match = String(text || '').match(/(Phase\s+\d+(?::\s*[^.]+)?)/i);
    return match?.[1]?.trim() || '';
}

function buildQueenPhaseWindowSummary(startPhase, endPhase) {
    const startNumber = extractQueenSummaryPhaseNumber(startPhase);
    const endNumber = extractQueenSummaryPhaseNumber(endPhase);
    if (startNumber && endNumber) {
        if (startNumber === endNumber) {
            return `Phase ${startNumber}`;
        }
        return `Phases ${startNumber} -> ${endNumber}`;
    }
    if (endPhase) {
        return endPhase;
    }
    return startPhase || '';
}

function extractQueenSummaryPhaseNumber(label) {
    const match = String(label || '').match(/phase\s+(\d+)/i);
    return match?.[1] || '';
}

function extractQueenChatAuthStatus(error) {
    const directStatus = Number.parseInt(String(error?.status || ''), 10);
    if (Number.isInteger(directStatus)) {
        return directStatus;
    }

    const message = String(error?.message || error || '');
    const match = message.match(/(?:^|\D)(401|403)(?:\D|$)/);
    if (!match) {
        return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    return Number.isInteger(parsed) ? parsed : null;
}
