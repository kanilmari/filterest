// row_article_load_session.test.js
// Checks request deduplication and pre-request ownership on related-row loads.
// Connects real sessions and state with a deferred transport.
// Keeps stale child identities out of article and detached related surfaces.
import { beforeEach, describe, expect, test } from "vitest";
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';
import { invalidateSessionGeneration } from '../../auth/session_generation_store.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';

import { createRowArticleLoadSession } from "./row_article_load_session.js";
beforeEach(() => { datasetAppearanceState.clear(); setAllSpecs({}); });

test.each(['sign-out', 'parent deletion', 'child deletion', 'ownership'])(
    'delayed related-row response is discarded after %s', async reason => {
        setAllSpecs({ parent: { table_uid: 11 }, child: { table_uid: 22 } });
        let complete;
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 1,
            requestFn: () => new Promise(resolve => { complete = resolve; }) });
        const pending = session.fetchDynamicChildren();
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        if (reason === 'sign-out') invalidateSessionGeneration({ reason: 'logout' });
        else if (reason === 'parent deletion') datasetAppearanceState.forget('parent');
        else if (reason === 'child deletion') datasetAppearanceState.forget('child');
        else setAllSpecs({ parent: { table_uid: 11 }, child: { table_uid: 33 }, renamed: { table_uid: 22 } });
        complete({ child_tables: [{ dataset: 'child', dataset_uid: 22, rows: [{ id: 1 }],
            dataset_appearance: { dataset_uid: 22, schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE,
                overrides: {}, version: '1', shared_version: 'site-1' } }] });
        await rejected;
        expect(datasetAppearanceState.savedSnapshot('child')).toBeNull();
    },
);

test('a child response retains its request guard until the related surface is assembled', async () => {
    const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 1,
        requestFn: async () => ({ child_tables: [{ dataset: 'child', rows: [{ id: 1 }] }] }) });
    const response = await session.fetchDynamicChildren();
    const token = response.child_tables[0].appearanceToken;
    expect(token).toBeDefined();
    expect(datasetAppearanceState.isCurrent(token)).toBe(true);
    datasetAppearanceState.forget('child');
    expect(datasetAppearanceState.isCurrent(token)).toBe(false);
});

test('out-of-order related revalidation cannot replace a newer shared snapshot at the same dataset revision', async () => {
    const completions = [];
    const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 1,
        requestFn: () => new Promise(resolve => { completions.push(resolve); }) });
    const older = session.fetchDynamicChildren(), newer = session.fetchDynamicChildren({ forceRefresh: true });
    const payload = width => ({ child_tables: [{ dataset: 'child', dataset_uid: 22,
        dataset_appearance: { dataset_uid: 22, schema_version: 1,
            effective: { ...DEFAULT_DATASET_APPEARANCE, shared: { ...DEFAULT_DATASET_APPEARANCE.shared, card_image_width: width } },
            overrides: {}, version: '1', shared_version: `site-${width}` } }] });
    completions[1](payload(440)); await newer;
    completions[0](payload(320)); await older;
    expect(datasetAppearanceState.effective('child').shared.card_image_width).toBe(440);
    expect(datasetAppearanceState.savedSnapshot('child').shared_version).toBe('site-440');
});

test.each(['denied', 'hidden'])('%s omission forgets appearance and rejects older in-flight snapshots', async () => {
    const snapshot = { dataset_uid: 22, schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE,
        overrides: {}, version: '1', shared_version: 'site-1' };
    datasetAppearanceState.accept('child', snapshot);
    const completions = [];
    const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 1,
        requestFn: () => new Promise(resolve => { completions.push(resolve); }) });
    const older = session.fetchDynamicChildren(), denial = session.fetchDynamicChildren({ forceRefresh: true });
    completions[1]({ child_tables: [{ dataset: 'child', rows: [{ id: 1 }] }] });
    const denied = await denial;
    expect.soft(denied.child_tables[0].appearanceAccepted).toBe(false);
    expect.soft(datasetAppearanceState.savedSnapshot('child')).toBeNull();
    completions[0]({ child_tables: [{ dataset: 'child', dataset_uid: 22, dataset_appearance: snapshot }] });
    const stale = await older;
    expect.soft(stale.child_tables[0].appearanceAccepted).toBe(false);
    expect.soft(datasetAppearanceState.savedSnapshot('child')).toBeNull();
    const recovery = session.fetchDynamicChildren({ forceRefresh: true });
    completions[2]({ child_tables: [{ dataset: 'child', dataset_uid: 22, dataset_appearance: snapshot }] });
    expect((await recovery).child_tables[0].appearanceAccepted).toBe(true);
    expect(datasetAppearanceState.savedSnapshot('child')).not.toBeNull();
});

test('an older omission cannot erase a later successful revalidation', async () => {
    const completions = [];
    const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 1,
        requestFn: () => new Promise(resolve => { completions.push(resolve); }) });
    const denial = session.fetchDynamicChildren(), success = session.fetchDynamicChildren({ forceRefresh: true });
    completions[1]({ child_tables: [{ dataset: 'child', dataset_uid: 22, dataset_appearance: {
        dataset_uid: 22, schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE,
        overrides: {}, version: '1', shared_version: 'site-1' } }] });
    await success;
    completions[0]({ child_tables: [{ dataset: 'child', rows: [{ id: 1 }] }] });
    await denial;
    expect(datasetAppearanceState.savedSnapshot('child')).not.toBeNull();
});

describe("createRowArticleLoadSession", () => {
    test("dedupes repeated full child-table fetches within one article-open session", async () => {
        const requests = [];
        const session = createRowArticleLoadSession({
            tableName: "dev_agent_tasks",
            rowId: 819,
            requestFn: async (routeName, options = {}) => {
                requests.push({ routeName, options });
                return { child_tables: [{ dataset: "dev_agent_task_comments" }] };
            },
        });

        const [first, second] = await Promise.all([
            session.fetchDynamicChildren(),
            session.fetchDynamicChildren(),
        ]);

        expect(first).toEqual(second);
        expect(requests).toHaveLength(1);
        expect(requests[0].routeName).toBe("fetchDynamicChildren");
    });

    test("force refresh invalidates cached child-table payloads", async () => {
        let calls = 0;
        const session = createRowArticleLoadSession({
            tableName: "dev_agent_tasks",
            rowId: 819,
            requestFn: async () => {
                calls += 1;
                return { revision: calls };
            },
        });

        await session.fetchDynamicChildren();
        const refreshed = await session.fetchDynamicChildren({ forceRefresh: true });

        expect(calls).toBe(2);
        expect(refreshed).toEqual({ revision: 2 });
    });

    test("caches the attachment linking status lookup per article-open session", async () => {
        const requests = [];
        const session = createRowArticleLoadSession({
            tableName: "dev_agent_tasks",
            rowId: 819,
            requestFn: async (routeName) => {
                requests.push(routeName);
                return {
                    image_asset_linkings: [{ enabled: true, routeName, kind: "image" }],
                    attachment_asset_linkings: [{ enabled: false, routeName, kind: "attachment" }],
                };
            },
        });

        const [firstAttachment, secondAttachment] = await Promise.all([
            session.fetchAttachmentLinking(),
            session.fetchAttachmentLinking(),
        ]);

        expect(firstAttachment).toEqual(secondAttachment);
        expect(requests).toEqual([
            "assetLinkingStatus",
        ]);
        expect(firstAttachment?.kind).toBe("attachment");

        await session.fetchAttachmentLinking({ forceRefresh: true });
        expect(requests).toHaveLength(2);
    });

    test("asks again after a failed attachment linking status lookup", async () => {
        let calls = 0;
        const session = createRowArticleLoadSession({
            tableName: "dev_agent_tasks",
            rowId: 819,
            requestFn: async () => {
                calls += 1;
                if (calls === 1) throw new Error("Unavailable");
                return { attachment_asset_linkings: [{ kind: "attachment" }] };
            },
        });

        await expect(session.fetchAttachmentLinking()).rejects.toThrow("Unavailable");
        await expect(session.fetchAttachmentLinking()).resolves.toEqual({ kind: "attachment" });
        expect(calls).toBe(2);
    });

    test("skips asset-linking status lookup when the route is not available", async () => {
        const requests = [];
        const session = createRowArticleLoadSession({
            tableName: "app_service_catalog",
            rowId: 395,
            canFetchLinkingStatus: false,
            requestFn: async (routeName) => {
                requests.push(routeName);
                return {};
            },
        });

        expect(await session.fetchAttachmentLinking()).toBeNull();
        expect(requests).toEqual([]);
    });
});
