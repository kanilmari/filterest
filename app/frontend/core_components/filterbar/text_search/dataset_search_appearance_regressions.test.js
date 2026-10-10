// dataset_search_appearance_regressions.test.js
// Exercises appearance lifetimes through the real search executor and stream reader.
// Connects deferred transport/render work with UID ownership and cached result placement.
// Prevents fresh render guards from reviving a cleared or reassigned search owner.
import { beforeEach, expect, test, vi } from 'vitest';
import { appendDataToTableMock, endpointRouterMock, listingAnswer, reloadDatasetRowsFromListingMock,
    resetDatasetSearchTest, createNdjsonStreamResponse } from './dataset_search_executor_test_setup.js';

beforeEach(resetDatasetSearchTest);

async function prepare() {
    const { datasetAppearanceState } = await import('../../table_views/dataset_appearance_state.js');
    const { setAllSpecs } = await import('../../state_stores/table_specs_reader.js');
    const { DEFAULT_DATASET_APPEARANCE } = await import('../../../shared/dataset_appearance/validator.js');
    const search = await import('./dataset_search_executor.js');
    setAllSpecs({ dev_agent_tasks: { table_uid: 11 } });
    datasetAppearanceState.accept('dev_agent_tasks', { dataset_uid: 11, schema_version: 1,
        effective: DEFAULT_DATASET_APPEARANCE, overrides: {}, version: '1' });
    reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ data: [{ id: 1 }], columns: ['id'] }));
    return { ...search, datasetAppearanceState, setAllSpecs };
}

function invalidate(state, reason) {
    if (reason === 'sign-out') state.datasetAppearanceState.clear();
    else if (reason === 'deletion') state.datasetAppearanceState.forget('dev_agent_tasks');
    else state.setAllSpecs({ dev_agent_tasks: { table_uid: 22 }, renamed: { table_uid: 11 } });
}

test.each(['sign-out', 'deletion', 'ownership'])('semantic results never render a late stream after %s', async reason => {
    const state = await prepare();
    let complete;
    endpointRouterMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = state.do_intelligent_search('dev_agent_tasks', 'private');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    invalidate(state, reason);
    complete(createNdjsonStreamResponse([{ stage: 'ai', data: [{ id: 42 }], columns: ['id'] }]));
    await pending;
    expect(state.ongoingSearchResults.dev_agent_tasks.aiData).toEqual([]);
    expect(appendDataToTableMock).not.toHaveBeenCalled();
    expect(document.getElementById('dev_agent_tasks_search_ai_table')).toBeNull();
});

test.each(['sign-out', 'deletion', 'ownership'])('cached semantic rows cannot start fresh rendering after %s', async reason => {
    const state = await prepare();
    endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: 'ai', data: [{ id: 42 }], columns: ['id'] }]));
    await state.do_intelligent_search('dev_agent_tasks', 'private');
    const retained = state.getSearchGroupsForViewRebuild('dev_agent_tasks', { query: 'private' });
    expect(retained.isCurrent()).toBe(true);
    document.getElementById('dev_agent_tasks_search_ai_table').remove();
    appendDataToTableMock.mockClear();
    invalidate(state, reason);
    expect(await retained.place()).toBe(false);
    expect(appendDataToTableMock).not.toHaveBeenCalled();
});
