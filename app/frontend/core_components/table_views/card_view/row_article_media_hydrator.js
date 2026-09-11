// row_article_media_hydrator.js
// Loads inline image credits and optional related media sections for one open article.
// Bridges the memoized article load session, shared media renderers and current-view guard.
// Keeps caption hydration independent of related-section visibility and editing permissions.

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
import { syncServiceCatalogInlineCachedImageVisibility } from "./row_article_service_catalog_image_syncer.js";
import {
    wrapRowArticleAttachmentSection,
    wrapRowArticleImageGallerySection,
    wrapRowArticleRelatedRowsSection,
} from "./row_article_tool_section_wrapper.js";
import { syncRowArticleInlineImageCaptions } from "./row_article_image_caption.js";
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
    canCommit,
    onLinkedTaskChildCountChange,
}) {
    let refreshMediaSections = async () => {};
    const hydrateRelatedSections = async () => {
        if (!canCommit() || !rowArticleElement.isConnected || !row_item.id) {
            return;
        }
        const hasInlineImage = Boolean(rowArticleContentElement.querySelector(
            ".big_card_image[data-row-article-image-column]",
        ));
        if (!show_related_items_on_big_cards && !hasInlineImage) return;

        // Main-image credits belong to the article, independently of the optional
        // related sections. Keep permitted parent credits if child loading fails.
        const syncInlineCaptions = (imageChild = null) => {
            if (!canCommit() || !rowArticleElement.isConnected) return;
            syncRowArticleInlineImageCaptions(
                rowArticleContentElement,
                resolveRowArticleImageRows(
                    imageChild?.rows || [],
                    imageChild ? [] : parent_row_image_rows,
                ),
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
                    syncServiceCatalogInlineCachedImageVisibility(
                        rowArticleContentElement,
                        table_name,
                        freshGalleryElement
                    );
                    upsertMediaSection(
                        ".row_article_image_gallery_section",
                        wrapRowArticleImageGallerySection(freshGalleryElement),
                        ".row_article_attachment_list_section, .row_article_related_items_section",
                    );
                    upsertMediaSection(
                        ".row_article_attachment_list_section",
                        wrapRowArticleAttachmentSection(await renderAttachments(
                            freshMediaState.attachmentChildForList,
                            freshMediaState.attachmentLinking,
                        )),
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
            syncServiceCatalogInlineCachedImageVisibility(
                rowArticleContentElement,
                table_name,
                galleryElement
            );
            if (galleryElement) {
                rowArticleContentElement.appendChild(
                    wrapRowArticleImageGallerySection(galleryElement)
                );
            }

            const attachmentList = await renderAttachments(
                initialMediaState.attachmentChildForList,
                initialMediaState.attachmentLinking,
            );
            if (!canCommit() || !rowArticleElement.isConnected) return;
            if (attachmentList) {
                rowArticleContentElement.appendChild(
                    wrapRowArticleAttachmentSection(attachmentList)
                );
            }

            const tabsEl = await buildRowArticleRelatedTabs(
                filterRowArticleNonMediaChildTables(dyn.child_tables),
                table_name,
                row_item.id,
                current_user_id,
                null,
                {
                    fetchDynamicChildren: rowArticleLoadSession.fetchDynamicChildren,
                }
            );
            if (tabsEl && canCommit() && rowArticleElement.isConnected) {
                rowArticleContentElement.appendChild(
                    wrapRowArticleRelatedRowsSection(tabsEl)
                );
            }
        } catch (err) {
            console.warn("virhe: %s", err.message);
        }
    };

    return {
        hydrateRelatedSections,
        // Saving article fields can happen before or after initial media hydration.
        refreshMediaSections: () => refreshMediaSections(),
    };
}
