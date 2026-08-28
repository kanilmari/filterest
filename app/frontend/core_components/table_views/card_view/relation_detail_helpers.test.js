import { describe, expect, test } from "vitest";
import {
    expandForeignKeyDetailEntry,
    expandForeignKeyDetailEntries,
    resolveRowArticleRelationDetailEntries,
} from "./relation_detail_helpers.js";
import { ROW_ARTICLE_RELATION_DETAILS_MODES } from "../../../ui_config.js";

describe("expandForeignKeyDetailEntry", () => {
    test("returns navigable id and display-name rows for FK details", () => {
        const detailEntry = {
            column: "parent_id",
            label: "Parent ID",
            rawValue: "Epic: Production Readiness 100%",
            isLink: false,
            columnClass: "col-parent-id",
            showKeyOnCard: true,
        };
        const rowItem = {
            parent_id: 305,
            "parent_name (ln)": "Epic: Production Readiness 100%",
        };
        const dataTypes = {
            parent_id: { foreign_table: "dev_agent_tasks" },
        };

        const expanded = expandForeignKeyDetailEntry(detailEntry, rowItem, dataTypes);

        expect(expanded).toHaveLength(2);
        expect(expanded[0].rawValue).toBe("305");
        expect(expanded[0].href).toBe("/dev_agent_tasks/305-epic-production-readiness-100");
        expect(expanded[0].dataColumn).toBe("parent_id");
        expect(expanded[1].column).toBe("parent_name");
        expect(expanded[1].label).toBe("Parent name");
        expect(expanded[1].rawValue).toBe("Epic: Production Readiness 100%");
        expect(expanded[1].dataColumn).toBeNull();
    });

    test("leaves non-FK details unchanged", () => {
        const detailEntry = {
            column: "priority",
            label: "Priority",
            rawValue: "normal",
            isLink: false,
        };

        expect(expandForeignKeyDetailEntry(detailEntry, { priority: "normal" }, {})).toEqual([
            detailEntry,
        ]);
    });

    test("localizes a multilingual generated FK display name", () => {
        localStorage.setItem("chosen_language", "yue");
        const detailEntry = {
            column: "service_id",
            label: "Service ID",
            rawValue: "12",
            isLink: false,
        };
        const rowItem = {
            service_id: 12,
            "service_name (ln)": JSON.stringify({
                en: "Supplier register maintenance",
                fi: "Toimittajarekisterin ylläpito",
                yue: "供應商登記冊維護",
            }),
        };
        const dataTypes = {
            service_id: { foreign_table: "services" },
        };

        const expanded = expandForeignKeyDetailEntry(detailEntry, rowItem, dataTypes);

        expect(expanded[1].rawValue).toBe("供應商登記冊維護");
        expect(expanded[1].href).toBe("/services/12");
        localStorage.removeItem("chosen_language");
    });

    test("leaves existing link details unchanged", () => {
        const detailEntry = {
            column: "website",
            label: "Website",
            rawValue: "https://example.com",
            isLink: true,
        };

        expect(expandForeignKeyDetailEntry(detailEntry, {}, {})).toEqual([detailEntry]);
    });
});

describe("expandForeignKeyDetailEntries", () => {
    test("flattens expanded FK detail rows in-order", () => {
        const entries = [
            {
                column: "queue_id",
                label: "Queue ID",
                rawValue: "Feature Development",
                isLink: false,
            },
            {
                column: "priority",
                label: "Priority",
                rawValue: "normal",
                isLink: false,
            },
        ];
        const rowItem = {
            queue_id: 12,
            "queue_name (ln)": "Feature Development",
            priority: "normal",
        };
        const dataTypes = {
            queue_id: { foreign_table: "dev_agent_task_queues" },
        };

        const expanded = expandForeignKeyDetailEntries(entries, rowItem, dataTypes);

        expect(expanded.map((entry) => entry.column)).toEqual([
            "queue_id",
            "queue_name",
            "priority",
        ]);
    });
});

describe("resolveRowArticleRelationDetailEntries", () => {
    const details = [
        { column: "priority", rawValue: "high", isLink: false },
        { column: "service_id", rawValue: "12", isLink: false },
        { column: "status", rawValue: "open", isLink: false },
    ];
    const rowItem = {
        priority: "high",
        service_id: 12,
        "service_name (ln)": "Supplier register maintenance",
        status: "open",
    };
    const dataTypes = {
        service_id: { foreign_table: "services" },
    };

    test("hides FK ids and names by default", () => {
        const resolved = resolveRowArticleRelationDetailEntries(details, rowItem, dataTypes);

        expect(resolved.map((entry) => entry.column)).toEqual(["priority", "status"]);
    });

    test("appends only FK names in names_at_end mode", () => {
        const resolved = resolveRowArticleRelationDetailEntries(
            details,
            rowItem,
            dataTypes,
            ROW_ARTICLE_RELATION_DETAILS_MODES.NAMES_AT_END
        );

        expect(resolved.map((entry) => entry.column)).toEqual([
            "priority",
            "status",
            "service_name",
        ]);
        expect(resolved.at(-1).rawValue).toBe("Supplier register maintenance");
    });

    test("appends FK ids and names in ids_and_names_at_end mode", () => {
        const resolved = resolveRowArticleRelationDetailEntries(
            details,
            rowItem,
            dataTypes,
            ROW_ARTICLE_RELATION_DETAILS_MODES.IDS_AND_NAMES_AT_END
        );

        expect(resolved.map((entry) => entry.column)).toEqual([
            "priority",
            "status",
            "service_id",
            "service_name",
        ]);
    });
});
