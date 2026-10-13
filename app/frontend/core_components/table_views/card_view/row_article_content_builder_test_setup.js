// row_article_content_builder_test_setup.js
// Provides controlled formatting, media and auth endpoint dependencies for article tests.
// Connects the real content builder and guest bootstrap to deterministic presentation fixtures.
// Keeps the shared renderer regressions within the repository file limit.

import { vi } from 'vitest';

const {
    createImageElementMock,
    createSeededAvatarMock,
    createRowArticleKeyValueElementMock,
    createRowArticleNavigableElementMock,
    createTicketStatusBadgeMock,
    bindImageFirstViewActivationMock,
    isTicketStatusFieldMock,
    resolveRowArticleTimestampDisplayOptionsMock,
    resolveRowArticleRelationDetailEntriesMock,
    fetchAuthModesMock,
    fetchUserPermissionsMock,
} = vi.hoisted(() => ({
    createImageElementMock: vi.fn(),
    createSeededAvatarMock: vi.fn(),
    createRowArticleKeyValueElementMock: vi.fn(),
    createRowArticleNavigableElementMock: vi.fn(),
    createTicketStatusBadgeMock: vi.fn(),
    bindImageFirstViewActivationMock: vi.fn(),
    isTicketStatusFieldMock: vi.fn(),
    resolveRowArticleTimestampDisplayOptionsMock: vi.fn(),
    resolveRowArticleRelationDetailEntriesMock: vi.fn((entries) => entries),
    fetchAuthModesMock: vi.fn(),
    fetchUserPermissionsMock: vi.fn(),
}));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../../endpoints/stable_endpoint_router.js', () => ({
    fetchAuthModes: fetchAuthModesMock, fetchUserPermissions: fetchUserPermissionsMock,
}));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../theme.js', () => ({ synchronizeThemePreferenceForAuthState: vi.fn() }));
vi.mock('./card_field_formatter.js', () => ({
    parseRoleString: vi.fn((roleString = '') => {
        const baseRoles = [];
        let hasLangKey = false;
        String(roleString || '').split(',').forEach((role) => {
            const parts = role.split('+').map((part) => part.trim()).filter(Boolean);
            const [mainRole, ...extras] = parts;
            if (mainRole) baseRoles.push(mainRole);
            if (extras.some((extra) => extra === 'lang-key' || extra === 'lang_key')) {
                hasLangKey = true;
            }
        });
        return { baseRoles, hasLangKey };
    }),
    format_column_name: vi.fn((column) => column),
    createTicketStatusBadge: createTicketStatusBadgeMock,
}));
vi.mock('./card_field_formatter_helpers.js', () => ({
    isGeneratedForeignDisplayColumn: vi.fn(() => false),
    isTicketStatusField: isTicketStatusFieldMock,
    resolveCardFieldDisplayValue: vi.fn((rowItem, column) => ({
        rawValue: rowItem[column] ?? '',
        displayValue: String(rowItem[column] ?? ''),
        isMultilingual: false,
    })),
}));
vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: vi.fn(() => 'mock-column'),
}));
vi.mock('./card_element_builder.js', () => ({
    addUsernameElement: vi.fn(() => document.createElement('div')),
}));
vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: createImageElementMock,
    create_seeded_avatar: createSeededAvatarMock,
}));
vi.mock('./image_first_view_activation.js', () => ({
    bindImageFirstViewActivation: bindImageFirstViewActivationMock,
}));
vi.mock('../../../ui_config.js', () => ({
    always_show_empty_fields_on_cards: true,
    row_article_relation_details_mode: 'hide',
}));
vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));
vi.mock('./row_article_presentation_settings.js', () => ({
    resolveRowArticleTimestampDisplayOptions: resolveRowArticleTimestampDisplayOptionsMock,
}));
vi.mock('./row_article_ui_handler.js', () => ({
    createRowArticleKeyValueElement: createRowArticleKeyValueElementMock,
    createRowArticleNavigableElement: createRowArticleNavigableElementMock,
    resolveRowArticleLocalizedValue: vi.fn((value) => String(value ?? '')),
}));
vi.mock('./row_article_content_builder_helpers.js', () => ({
    extractSuffixNumber: vi.fn(() => 0),
    resolveImagePath: vi.fn((value) => value),
    classifyRole: vi.fn((role) => role),
}));
vi.mock('./relation_detail_helpers.js', () => ({
    expandForeignKeyDetailEntries: vi.fn((entries) => entries),
    resolveRowArticleRelationDetailEntries: resolveRowArticleRelationDetailEntriesMock,
}));


export {
    createImageElementMock,
    createSeededAvatarMock,
    createRowArticleKeyValueElementMock,
    createRowArticleNavigableElementMock,
    createTicketStatusBadgeMock,
    bindImageFirstViewActivationMock,
    isTicketStatusFieldMock,
    resolveRowArticleTimestampDisplayOptionsMock,
    resolveRowArticleRelationDetailEntriesMock,
    fetchAuthModesMock,
    fetchUserPermissionsMock,
};
