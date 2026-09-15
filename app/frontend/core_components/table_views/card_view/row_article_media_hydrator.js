// row_article_media_hydrator.js
// Loads inline image credits and optional related media sections for one open article.
// Bridges the memoized article load session, shared media renderers and current-view guard.
// Keeps caption hydration independent of related-section visibility and editing permissions.

import { resolveRowArticleSectionStartOpen } from "./row_article_section_defaults.js";
import {
    attachRowArticleContentScrollPersistence,
    bindRelatedRowsDisclosurePersist,
    readRowArticleViewRestoreState,
    waitForRowArticleLayoutPass,
} from "./row_article_view_restore_state.js";

import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { buildRowArticleImageGallery } from "./row_article_image_gallery.js";
import { buildRowArticleAttachmentList } from "./row_article_attachment_list.js";
import {
    filterRowArticleNonMediaChildTables,
    resolveRowArticleAttachmentListChild,
    resolveRowArticleDynamicAssetChildren,
    resolveRowArticleImageGalleryChild,
} from "./row_article_asset_resolver.js";
import { hasDatasetPermission, primeDatasetPermissions } from "../../route_permission_checker.js";
import {
    wrapRowArticleAttachmentSection,
    wrapRowArticleImageGallerySection,
    wrapRowArticleRelatedRowsSection,
} from "./row_article_tool_section_wrapper.js";
import { disposeRowArticleInlineMedia, syncRowArticleInlineMedia } from "./row_article_inline_media.js";
import { resolveRowArticleImageRows } from "./row_article_image_rows.js";

/**
 * Creates one article's hydration and refresh callbacks from its explicit view context.
 * Reuses permission-checked cached reads and prevents late responses changing an obsolete view.
 */
export function createRowArticleMediaHydrator({
    rowArticleElement,
    rowArticleContentElement,
    rowArticleLoadSession,
    rowItem: row_item,
    tableName: table_name,
    selectedCard,
    rowLabel: row_presentation_label,
    parentImageRows: parent_row_image_rows,
    tableHasImageRole: table_has_image_role,
    currentUserId: current_user_id,
    showRelatedItems: show_related_items_on_big_cards,
    canCommit: isCurrent,
    onLinkedTaskChildCountChange,
    sectionDefaults = {},
}) {
    let disposed = false;
    let connectionObserver = null;
    let observedAncestors = [];
    const canCommit = () => !disposed && isCurrent() && rowArticleElement.isConnected
        && rowArticleElement.contains(rowArticleContentElement);
    const scrollPersistence = attachRowArticleContentScrollPersistence(
        rowArticleContentElement,
        table_name,
        row_item.id,
        { isCurrent: canCommit },
    );
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        scrollPersistence.detach();
        connectionObserver?.disconnect();
        observedAncestors = [];
        disposeRowArticleInlineMedia(rowArticleContentElement);
    };
    const observeArticleConnection = () => {
        const ancestors = [];
        for (let node = rowArticleContentElement.parentNode; node; node = node.parentNode) {
            ancestors.push(node);
        }
        if (ancestors.length === observedAncestors.length
            && ancestors.every((node, index) => node === observedAncestors[index])) return;
        if (!connectionObserver) {
            // Watch direct parent-child boundaries, not every image/caption mutation.
            // This also catches removal of an entire view or dataset ancestor.
            connectionObserver = new MutationObserver(() => {
                if (!rowArticleElement.isConnected || !rowArticleElement.contains(rowArticleContentElement)) {
                    dispose();
                } else {
                    observeArticleConnection();
                }
            });
        } else {
            connectionObserver.disconnect();
        }
        observedAncestors = ancestors;
        ancestors.forEach(node => connectionObserver.observe(node, { childList: true }));
    };
    const sectionOpenState = new Map();
    const sectionOptions = (key, selector) => {
        const existing = rowArticleContentElement.querySelector(selector);
        const restore = readRowArticleViewRestoreState(table_name, row_item.id);
        let defaults = sectionOpenState.has(key)
            ? { [key]: sectionOpenState.get(key) }
            : sectionDefaults;
        if (key === "related_rows" && !existing && typeof restore.relatedRowsOpen === "boolean") {
            defaults = { ...defaults, related_rows: restore.relatedRowsOpen };
        }
        const startOpen = resolveRowArticleSectionStartOpen(defaults, key, existing);
        sectionOpenState.set(key, startOpen);
        return { startOpen };
    };
    let refreshMediaSections = async () => {};
    const hydrateRelatedSections = async () => {
        if (!canCommit() || !rowArticleElement.isConnected || !row_item.id) {
            return;
        }
        const hasInlineImage = Boolean(rowArticleContentElement.querySelector(
            ".big_card_image[data-row-article-image-column]",
        ));
        if (!show_related_items_on_big_cards && !hasInlineImage) {
            await waitForRowArticleLayoutPass();
            if (canCommit()) scrollPersistence.restore();
            return;
        }
        observeArticleConnection();

        // Main-image credits belong to the article, independently of the optional
        // related sections. Keep permitted parent credits if child loading fails.
        const syncInlineCaptions = (imageChild = null) => {
            if (!canCommit() || !rowArticleElement.isConnected) return;
            syncRowArticleInlineMedia(
                rowArticleContentElement,
                resolveRowArticleImageRows(
                    imageChild?.rows || [],
                    imageChild ? [] : parent_row_image_rows,
                ),
                { rowItem: row_item, tableName: table_name, selectedCard, rowLabel: row_presentation_label, canCommit },
            );
        };
        syncInlineCaptions();

        try {
            const buildMediaState = async (childTables = []) => {
                const { imagesChild, assetsChild } = resolveRowArticleDynamicAssetChildren(childTables);
                const [imageLinking, attachmentLinking] = await Promise.all([
                    rowArticleLoadSession.fetchImageLinking(),
                    show_related_items_on_big_cards
                        ? rowArticleLoadSession.fetchAttachmentLinking()
                        : Promise.resolve(null),
                ]);

                return {
                    attachmentChildForList: resolveRowArticleAttachmentListChild(
                        table_name,
                        attachmentLinking,
                        assetsChild,
                    ),
                    attachmentLinking,
                    imageChildForGallery: resolveRowArticleImageGalleryChild(
                        table_name,
                        table_has_image_role,
                        imageLinking,
                        imagesChild,
                        assetsChild,
                    ),
                    imageLinking,
                };
            };

            const upsertMediaSection = (selector, nextElement, anchorSelector = null) => {
                if (!canCommit() || !rowArticleElement.isConnected) {
                    return;
                }

                const oldElement = rowArticleContentElement.querySelector(selector);
                if (oldElement && nextElement) {
                    oldElement.replaceWith(nextElement);
                    return;
                }
                if (oldElement && !nextElement) {
                    oldElement.remove();
                    return;
                }
                if (!nextElement) {
                    return;
                }
                const anchor = anchorSelector
                    ? rowArticleContentElement.querySelector(anchorSelector)
                    : null;
                rowArticleContentElement.insertBefore(nextElement, anchor || null);
            };

            const renderGallery = async (imgChild) => {
                const imageDataset = imgChild?.dataset || "";
                if (imageDataset) {
                    void primeDatasetPermissions(imageDataset, [
                        "/api/add-row-multipart",
                        "/api/delete-rows",
                        "/api/update-row",
                    ]);
                }
                const [
                    canUpload,
                    canDelete,
                    canUpdate,
                ] = imageDataset
                    ? await Promise.all([
                        hasDatasetPermission("/api/add-row-multipart", imageDataset),
                        hasDatasetPermission("/api/delete-rows", imageDataset),
                        hasDatasetPermission("/api/update-row", imageDataset),
                    ])
                    : [false, false, false];
                if (!canCommit() || !rowArticleElement.isConnected) return null;

                const galleryPermissions = {
                    canUpload,
                    canDelete,
                    canSetPrimary: canUpdate,
                    canEditMetadata: canUpdate,
                    // Once the related image dataset has resolved, its rows are
                    // authoritative. Reusing the parent row's cached image here
                    // would resurrect a just-deleted asset until the next F5.
                    parentImageRows: imgChild ? [] : parent_row_image_rows,
                    imageFirstContext: {
                        rowItem: row_item,
                        tableName: table_name,
                        selectedCard,
                        rowLabel: row_presentation_label,
                    },
                };
                return buildRowArticleImageGallery(
                    table_name,
                    row_item.id,
                    imgChild,
                    refreshMediaSections,
                    galleryPermissions
                );
            };

            const renderAttachments = async (assetChild, attachmentLinking) => {
                return buildRowArticleAttachmentList(
                    table_name,
                    row_item.id,
                    assetChild,
                    refreshMediaSections,
                    { linkingStatus: attachmentLinking },
                );
            };

            refreshMediaSections = async () => {
                try {
                    const fresh = await rowArticleLoadSession.fetchDynamicChildren({
                        forceRefresh: true,
                    });
                    if (!canCommit() || !rowArticleElement.isConnected) return;
                    const freshMediaState = await buildMediaState(fresh?.child_tables || []);
                    if (!canCommit() || !rowArticleElement.isConnected) return;
                    syncInlineCaptions(freshMediaState.imageChildForGallery);
                    const freshGalleryElement = await renderGallery(freshMediaState.imageChildForGallery);
                    if (!canCommit() || !rowArticleElement.isConnected) return;
                    upsertMediaSection(
                        ".row_article_image_gallery_section",
                        wrapRowArticleImageGallerySection(freshGalleryElement, sectionOptions("images", ".row_article_image_gallery_section")),
                        ".row_article_attachment_list_section, .row_article_related_items_section",
                    );
                    upsertMediaSection(
                        ".row_article_attachment_list_section",
                        wrapRowArticleAttachmentSection(await renderAttachments(
                            freshMediaState.attachmentChildForList,
                            freshMediaState.attachmentLinking,
                        ), sectionOptions("attachments", ".row_article_attachment_list_section")),
                        ".row_article_related_items_section",
                    );
                } catch (refreshErr) {
                    console.warn("big-card media refresh error:", refreshErr?.message || refreshErr);
                }
            };

            const dyn = await rowArticleLoadSession.fetchDynamicChildren();
            if (!canCommit() || !rowArticleElement.isConnected || !Array.isArray(dyn?.child_tables)) {
                return;
            }
            const initialMediaState = await buildMediaState(dyn.child_tables);
            if (!canCommit() || !rowArticleElement.isConnected) return;
            syncInlineCaptions(initialMediaState.imageChildForGallery);
            if (!show_related_items_on_big_cards) return;

            // fetchDynamicChildren keeps the legacy child_tables envelope,
            // but each related-tab entry uses `column` as the FK key name.
            const linkedTaskChildTable = dyn.child_tables.find(
                c => c.dataset === 'dev_agent_tasks' && c.column === 'parent_id'
            ) || null;
            const linkedTaskRowCount = Number.parseInt(
                String(linkedTaskChildTable?.row_count ?? ''),
                10
            );
            onLinkedTaskChildCountChange(Number.isFinite(linkedTaskRowCount)
                ? linkedTaskRowCount
                : Array.isArray(linkedTaskChildTable?.rows)
                    ? linkedTaskChildTable.rows.length
                    : 0);

            const galleryElement = await renderGallery(initialMediaState.imageChildForGallery);
            if (!canCommit() || !rowArticleElement.isConnected) return;
            if (galleryElement) {
                rowArticleContentElement.appendChild(
                    wrapRowArticleImageGallerySection(galleryElement, sectionOptions("images", ".row_article_image_gallery_section"))
                );
            }

            const attachmentList = await renderAttachments(
                initialMediaState.attachmentChildForList,
                initialMediaState.attachmentLinking,
            );
            if (!canCommit() || !rowArticleElement.isConnected) return;
            if (attachmentList) {
                rowArticleContentElement.appendChild(
                    wrapRowArticleAttachmentSection(attachmentList, sectionOptions("attachments", ".row_article_attachment_list_section"))
                );
            }

            const restore = readRowArticleViewRestoreState(table_name, row_item.id);
            const tabsEl = await buildRowArticleRelatedTabs(
                filterRowArticleNonMediaChildTables(dyn.child_tables),
                table_name,
                row_item.id,
                current_user_id,
                restore.relatedTabKey,
                {
                    fetchDynamicChildren: rowArticleLoadSession.fetchDynamicChildren,
                }
            );
            if (tabsEl && canCommit() && rowArticleElement.isConnected) {
                const relatedSection = wrapRowArticleRelatedRowsSection(
                    tabsEl,
                    sectionOptions("related_rows", ".row_article_related_items_section"),
                );
                bindRelatedRowsDisclosurePersist(relatedSection, table_name, row_item.id);
                rowArticleContentElement.appendChild(relatedSection);
            }
        } catch (err) {
            console.warn("virhe: %s", err.message);
        } finally {
            if (canCommit()) {
                await waitForRowArticleLayoutPass();
            }
            if (canCommit()) {
                scrollPersistence.restore();
            }
        }
    };

    return {
        hydrateRelatedSections,
        dispose,
        // Saving article fields can happen before or after initial media hydration.
        refreshMediaSections: () => canCommit() ? refreshMediaSections() : undefined,
    };
}
