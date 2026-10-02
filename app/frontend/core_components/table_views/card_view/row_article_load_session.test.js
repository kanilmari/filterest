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
