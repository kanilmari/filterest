// contract_reader.test.js
// Holds active browser constants and reserved vocabulary to the shared contract.
// Connects registry, K379 access guard and legacy disclosure settings.
// Prevents a future route split from silently changing today's compatibility gate.
import { describe, expect, test } from 'vitest';
import { ARTICLE_PRESENTATION_CONTRACT as contract, LEGACY_ARTICLE_BLOCKS } from './contract_reader.js';
import { ARTICLE_VIEW_KEY, IMAGE_FIRST_VIEW_KEY, DATASET_VIEW_DEFINITIONS,
    getDatasetViewDefinition, normalizeDatasetViewKey } from '../../core_components/table_views/dataset_view_registry.js';
import { ARTICLE_VIEW_ROUTE } from '../../core_components/table_views/card_view/article_view_access.js';
import { ROW_ARTICLE_VIEW_KEY } from '../../core_components/table_views/card_view/row_article_data_fetcher.js';

import orderExamples from '../../../testing/shared_contracts/legacy_ifav_order_examples.json' with { type: 'json' };
import { sortColumnsByRole } from '../../core_components/table_views/card_view/row_article_opener_helpers.js';

describe('article presentation contract drift', () => {
    test('retains current keys, aliases and permission gates without registering the reserved view', () => {
        expect([ARTICLE_VIEW_KEY, IMAGE_FIRST_VIEW_KEY]).toEqual(
            Object.keys(contract.presentations).filter(key => !contract.presentations[key].reserved));
        expect(ROW_ARTICLE_VIEW_KEY).toBe(ARTICLE_VIEW_KEY);
        expect(ARTICLE_VIEW_ROUTE).toBe(contract.presentations.article_view.current_permission_route);
        for (const [alias, key] of Object.entries(contract.aliases)) {
            expect(normalizeDatasetViewKey(alias)).toBe(key);
        }
        for (const [key, value] of Object.entries(contract.presentations)) {
            expect(value.permission_route).toBe(`/ui/view/${key}`);
            if (value.reserved) expect(getDatasetViewDefinition(key)).toBeNull();
            else expect(getDatasetViewDefinition(key).permissionRoute).toBe(value.current_permission_route);
        }
        expect(DATASET_VIEW_DEFINITIONS.find(value => value.viewKey === IMAGE_FIRST_VIEW_KEY).rendererKey).toBeUndefined();
        expect(normalizeDatasetViewKey('toString')).toBe('toString');
        const nonStringKey = { toString: () => 'article' };
        expect(normalizeDatasetViewKey(nonStringKey)).toBe(nonStringKey);
    });
    test('owns supported blocks and every approved opener default as immutable data', () => {
        expect(LEGACY_ARTICLE_BLOCKS).toEqual({ classic: contract.blocks, image_first: ['details'] });
        expect(contract.absent_block_initial_open).toBe(true);
        expect(Object.keys(contract.opener_defaults).sort()).toEqual([
            'article-image', 'calendar-event', 'card-body', 'card-image', 'card-summary', 'card-title',
            'field-link', 'free-layout-body', 'free-layout-image', 'gallery-thumbnail', 'home-button',
            'product-body', 'product-image', 'search-result', 'show-more',
        ]);
        for (const [role, key] of Object.entries(contract.opener_defaults)) {
            expect(key).toBe(['card-image', 'article-image', 'gallery-thumbnail'].includes(role)
                ? 'image_first_view' : 'article_view');
        }
        expect(Object.isFrozen(contract.presentations.article_view.blocks)).toBe(true);
    });
});

test('baseline IFAV examples match the current browser role sorter on server JSON keys', () => {
    for (const example of orderExamples) {
        const names = example.fields.map(field => field.column).sort();
        const types = Object.fromEntries(example.fields.map(field => [field.column, field]));
        expect(sortColumnsByRole(names, types)).toEqual(example.ordered);
    }
});
