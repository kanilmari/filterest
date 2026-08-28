import { describe, expect, test } from "vitest";

import { createRowArticleLoadSession } from "./row_article_load_session.js";

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

    test("caches attachment and image linking status lookups per article-open session", async () => {
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

        const [firstImage, secondImage, firstAttachment, secondAttachment] = await Promise.all([
            session.fetchImageLinking(),
            session.fetchImageLinking(),
            session.fetchAttachmentLinking(),
            session.fetchAttachmentLinking(),
        ]);

        expect(firstImage).toEqual(secondImage);
        expect(firstAttachment).toEqual(secondAttachment);
        expect(requests).toEqual([
            "assetLinkingStatus",
        ]);
        expect(firstImage?.kind).toBe("image");
        expect(firstAttachment?.kind).toBe("attachment");
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

        const [imageLinking, attachmentLinking] = await Promise.all([
            session.fetchImageLinking(),
            session.fetchAttachmentLinking(),
        ]);

        expect(imageLinking).toBeNull();
        expect(attachmentLinking).toBeNull();
        expect(requests).toEqual([]);
    });
});
