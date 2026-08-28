// workline_observatory_state_builder.test.js
// Verifies exact phase 0-6 tracks and stable selected-workline state.
// Bridges canonical board snapshots with the right-aligned six-slot NOW model.
// Exists so the coarse checkpoint gate can never replace the exact phase again.

import { describe, expect, test } from 'vitest';
import {
    buildWorklineObservatoryState,
    buildWorklinePhaseNodes,
    getSelectedObservatoryWorklines,
    replaceObservatoryWorklineSelection,
    selectObservatoryWorkline,
    toggleObservatoryWorklineSelection,
} from './workline_observatory_state_builder.js';

describe('workline observatory state', () => {
    test('counts active and paused worklines as open', () => {
        const state = buildWorklineObservatoryState({
            worklines: [
                { id: 1, status: 'active', current_phase: 4 },
                { id: 2, status: 'paused', current_phase: 2 },
                { id: 3, status: 'closed', current_phase: 6 },
                { id: 4, status: 'archived', current_phase: 3 },
            ],
        });

        expect(state.openWorklineCount).toBe(2);
    });

    test('keeps NOW stationary while rendering history and every future phase', () => {
        const phaseZero = buildWorklinePhaseNodes(0);
        expect(phaseZero).toHaveLength(7);
        expect(phaseZero.map((node) => node.slot)).toEqual([7, 8, 9, 10, 11, 12, 13]);
        expect(phaseZero[0]).toEqual({ phase: 0, slot: 7, state: 'not-started', filled: false, isNow: true });
        expect(phaseZero.slice(1).every((node) => node.state === 'future')).toBe(true);

        const phaseThree = buildWorklinePhaseNodes(3);
        expect(phaseThree).toHaveLength(6);
        expect(phaseThree.map((node) => node.slot)).toEqual([5, 6, 7, 8, 9, 10]);
        expect(phaseThree.map((node) => node.state)).toEqual(['completed', 'completed', 'current', 'future', 'future', 'future']);
        expect(phaseThree.find((node) => node.isNow)?.phase).toBe(3);

        const phaseSix = buildWorklinePhaseNodes(6, 'active');
        expect(phaseSix.map((node) => node.slot)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(phaseSix.at(-1)).toEqual({ phase: 6, slot: 7, state: 'current', filled: true, isNow: true });
    });

    test('moves all six phases behind NOW only after the lifecycle is closed', () => {
        const state = buildWorklineObservatoryState({
            worklines: [{ id: 1, status: 'closed', current_phase: 5 }],
        });
        const workline = state.worklines[0];

        expect(workline.reported_current_phase).toBe(5);
        expect(workline.current_phase).toBe(6);
        expect(workline.phase_nodes.map((node) => node.slot)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(workline.phase_nodes.every((node) => node.state === 'completed')).toBe(true);
        expect(workline.phase_nodes.some((node) => node.isNow)).toBe(false);
        expect(workline.history_link_count).toBe(6);
        expect(workline.future_link_count).toBe(0);
        expect(buildWorklinePhaseNodes(2, 'archived').every((node) => node.state === 'completed')).toBe(true);
    });

    test('keeps exact phase independent from the coarse phase gate', () => {
        const state = buildWorklineObservatoryState({
            worklines: [{
                id: 1,
                title: 'Early work',
                current_phase: 1,
                latest_report: { phase_gate: '3-4' },
            }],
        });
        expect(state.worklines[0].current_phase).toBe(1);
        expect(state.worklines[0].phase_nodes).toHaveLength(6);
    });

    test('selects only a workline present in the current snapshot', () => {
        const state = buildWorklineObservatoryState({
            worklines: [{ id: 1 }, { id: 2 }],
        });
        expect(selectObservatoryWorkline(state, 2).selectedWorklineId).toBe(2);
        expect(selectObservatoryWorkline(state, 99)).toBe(state);
    });

    test('toggles multiple action selections while retaining one detail focus', () => {
        const state = buildWorklineObservatoryState({
            worklines: [{ id: 1 }, { id: 2 }, { id: 3 }],
        });
        const twoSelected = toggleObservatoryWorklineSelection(
            toggleObservatoryWorklineSelection(state, 1),
            3,
        );
        expect(twoSelected.selectedWorklineIds).toEqual([1, 3]);
        expect(twoSelected.selectedWorklineId).toBe(3);
        expect(getSelectedObservatoryWorklines(twoSelected).map((row) => row.id)).toEqual([1, 3]);

        const replaced = replaceObservatoryWorklineSelection(twoSelected, [2, 99], 2);
        expect(replaced.selectedWorklineIds).toEqual([2]);
        expect(replaced.selectedWorklineId).toBe(2);
    });
});
