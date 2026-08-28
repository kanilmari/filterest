// workline_observatory_state_builder.js
// Normalizes board data into deterministic phase tracks and selection state.
// Bridges the backend snapshot with DOM rendering without hiding malformed phases.
// Exists so phase 0-6 behavior is testable independently from layout and network calls.

export function normalizeWorklinePhase(value) {
    const phase = Number(value);
    return Number.isInteger(phase) && phase >= 0 && phase <= 6 ? phase : 0;
}

export function buildWorklinePhaseNodes(value, lifecycleStatus = 'active') {
    const phase = normalizeWorklinePhase(value);
    // Phase 6 is still NOW while work is active. Only an owner/agent lifecycle
    // close or discard turns the whole six-phase track into history.
    if (lifecycleStatus === 'closed' || lifecycleStatus === 'archived') {
        return [1, 2, 3, 4, 5, 6].map((nodePhase) => ({
            phase: nodePhase,
            slot: nodePhase,
            state: 'completed',
            filled: true,
            isNow: false,
        }));
    }
    const visiblePhases = phase === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];
    return visiblePhases.map((nodePhase) => {
        const isNow = nodePhase === phase;
        return {
            phase: nodePhase,
            slot: 7 + nodePhase - phase,
            state: nodePhase === 0 ? 'not-started' : nodePhase < phase ? 'completed' : isNow ? 'current' : 'future',
            filled: nodePhase > 0 && nodePhase <= phase,
            isNow,
        };
    });
}

export function buildWorklineObservatoryState(snapshot = {}) {
    const worklines = Array.isArray(snapshot.worklines)
        ? snapshot.worklines.map((workline) => {
            const reportedPhase = normalizeWorklinePhase(workline?.current_phase);
            const terminal = workline?.status === 'closed' || workline?.status === 'archived';
            const currentPhase = terminal ? 6 : reportedPhase;
            return {
                ...workline,
                reported_current_phase: reportedPhase,
                current_phase: currentPhase,
                phase_nodes: buildWorklinePhaseNodes(currentPhase, workline?.status),
                history_link_count: terminal ? 6 : Math.max(0, currentPhase - 1),
                future_link_count: terminal ? 0 : 6 - currentPhase,
            };
        })
        : [];
    return {
        worklines,
        openWorklineCount: worklines.filter((workline) =>
            workline.status === 'active' || workline.status === 'paused'
        ).length,
        releaseGoal: snapshot.release_goal || null,
        selectedWorklineId: worklines[0]?.id ?? null,
        selectedWorklineIds: [],
        generatedAt: snapshot.generated_at || '',
    };
}

export function selectObservatoryWorkline(state, worklineId) {
    if (!state.worklines.some((workline) => workline.id === worklineId)) return state;
    return { ...state, selectedWorklineId: worklineId };
}

export function getSelectedObservatoryWorkline(state) {
    return state.worklines.find((workline) => workline.id === state.selectedWorklineId) || null;
}

export function toggleObservatoryWorklineSelection(state, worklineId) {
    if (!state.worklines.some((workline) => workline.id === worklineId)) return state;
    const selected = new Set(state.selectedWorklineIds || []);
    if (selected.has(worklineId)) selected.delete(worklineId);
    else selected.add(worklineId);
    return {
        ...state,
        selectedWorklineId: worklineId,
        selectedWorklineIds: [...selected],
    };
}

export function replaceObservatoryWorklineSelection(state, worklineIds, focusedWorklineId = null) {
    const available = new Set(state.worklines.map((workline) => workline.id));
    const selected = [...new Set(worklineIds)].filter((id) => available.has(id));
    const focus = available.has(focusedWorklineId)
        ? focusedWorklineId
        : selected.at(-1) ?? state.selectedWorklineId;
    return { ...state, selectedWorklineId: focus, selectedWorklineIds: selected };
}

export function getSelectedObservatoryWorklines(state) {
    const selected = new Set(state.selectedWorklineIds || []);
    return state.worklines.filter((workline) => selected.has(workline.id));
}
