// @vitest-environment jsdom
// row_article_media_hydrator_permissions.test.js
// Verifies hidden article tools are never built during initial hydration or refresh.
// Connects session UI grants to the real media orchestrator and disclosure wrappers.
// Protects the independent main image and the unchanged related-tab input contract.

import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('./row_article_inline_media.js', () => ({
    syncRowArticleInlineMedia: vi.fn(), disposeRowArticleInlineMedia: vi.fn(),
}));
vi.mock('./row_article_image_gallery.js', () => ({ buildRowArticleImageGallery: vi.fn() }));
vi.mock('./row_article_attachment_list.js', () => ({ buildRowArticleAttachmentList: vi.fn() }));
vi.mock('./row_article_child_tabs.js', () => ({ buildRowArticleRelatedTabs: vi.fn() }));
vi.mock('../../route_permission_checker.js', () => ({
    hasDatasetPermission: vi.fn(async () => true), primeDatasetPermissions: vi.fn(),
}));

import { createRowArticleMediaHydrator } from './row_article_media_hydrator.js';
import { ROW_ARTICLE_PERMISSION_ROUTES } from './row_article_permission_checker.js';
import { buildRowArticleImageGallery } from './row_article_image_gallery.js';
import { buildRowArticleAttachmentList } from './row_article_attachment_list.js';
import { buildRowArticleRelatedTabs } from './row_article_child_tabs.js';
import { syncRowArticleInlineMedia } from './row_article_inline_media.js';

const builders = { images: buildRowArticleImageGallery, attachments: buildRowArticleAttachmentList, related_rows: buildRowArticleRelatedTabs };
const selectors = { images: '.row_article_image_gallery_section', attachments: '.row_article_attachment_list_section', related_rows: '.row_article_related_items_section' };
const children = [
    { dataset: 'notes', column: 'parent_id', rows: [{ id: 8 }] },
    { dataset: 'todos', column: 'row_id', rows: [{ id: 9 }] },
];

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    for (const builder of Object.values(builders)) vi.mocked(builder).mockImplementation(() => document.createElement('div'));
});

async function hydrate(grants) {
    sessionStorage.setItem('user_permissions', JSON.stringify(grants));
    const article = document.createElement('article');
    const content = document.createElement('div');
    content.innerHTML = '<div class="big_card_image" data-row-article-image-column="photo"><img src="/photo.jpg"></div>';
    article.append(content); document.body.append(article);
    const session = {
        fetchDynamicChildren: vi.fn(async () => ({ child_tables: children })),
        fetchAttachmentLinking: vi.fn(async () => null),
    };
    const controller = createRowArticleMediaHydrator({
        rowArticleElement: article, rowArticleContentElement: content, rowArticleLoadSession: session,
        rowItem: { id: 1 }, tableName: 'events', parentImageRows: [], currentUserId: 42,
        showRelatedItems: true, canCommit: () => true, onLinkedTaskChildCountChange: vi.fn(),
    });
    await controller.hydrateRelatedSections();
    return { controller, content, session };
}

test.each(['user', 'guest'])('%s defaults never build optional media tools, including on refresh', async () => {
    const { controller, content, session } = await hydrate([ROW_ARTICLE_PERMISSION_ROUTES.details]);
    await controller.refreshMediaSections();
    for (const builder of Object.values(builders)) expect(builder).not.toHaveBeenCalled();
    for (const selector of Object.values(selectors)) expect(content.querySelector(selector)).toBeNull();
    expect(content.querySelector('.big_card_image img').getAttribute('src')).toBe('/photo.jpg');
    expect(syncRowArticleInlineMedia).toHaveBeenCalled();
    expect(session.fetchAttachmentLinking).not.toHaveBeenCalled();
    controller.dispose();
});

test.each(Object.keys(builders))('granting %s builds just that section and retains the rule on refresh', async (key) => {
    const { controller, content } = await hydrate([ROW_ARTICLE_PERMISSION_ROUTES.details, ROW_ARTICLE_PERMISSION_ROUTES[key]]);
    await controller.refreshMediaSections();
    for (const [section, builder] of Object.entries(builders)) {
        expect(Boolean(vi.mocked(builder).mock.calls.length)).toBe(section === key);
        expect(Boolean(content.querySelector(selectors[section]))).toBe(section === key);
    }
    controller.dispose();
});

test('administrator builds all media sections and passes the same tabs, order and arguments', async () => {
    const { controller, content, session } = await hydrate(Object.values(ROW_ARTICLE_PERMISSION_ROUTES));
    for (const selector of Object.values(selectors)) expect(content.querySelector(selector)).not.toBeNull();
    expect(buildRowArticleRelatedTabs).toHaveBeenCalledWith(children, 'events', 1, 42, null, {
        fetchDynamicChildren: session.fetchDynamicChildren,
    });
    controller.dispose();
});

test('revoking a gallery or attachment grant prevents rebuilding it and removes its old section', async () => {
    const { controller, content } = await hydrate(Object.values(ROW_ARTICLE_PERMISSION_ROUTES));
    vi.clearAllMocks();
    sessionStorage.setItem('user_permissions', JSON.stringify([ROW_ARTICLE_PERMISSION_ROUTES.details]));
    await controller.refreshMediaSections();
    expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    expect(buildRowArticleAttachmentList).not.toHaveBeenCalled();
    expect(content.querySelector(selectors.images)).toBeNull();
    expect(content.querySelector(selectors.attachments)).toBeNull();
    controller.dispose();
});
