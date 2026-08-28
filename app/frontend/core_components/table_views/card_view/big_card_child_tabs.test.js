// @vitest-environment jsdom
// big_card_child_tabs.test.js
// Verifies related-record article navigation does not pollute browser history.
// Bridges related-tab row clicks with the shared navigation handler contract.
// Exists so Back returns to the previous article instead of an intermediate card list.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { DATE_TIME_DISPLAY_SEPARATOR } from "../timestamp_display_formatter.js";

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

const mocks = vi.hoisted(() => ({
    closeRowArticle: vi.fn((wrapper, _cardContainer, bigCard) => {
        bigCard.remove();
        wrapper.classList.remove("big-card-open");
    }),
    endpointRouter: vi.fn(() => Promise.resolve([])),
    handleAllNavigation: vi.fn(() => Promise.resolve()),
    hasDatasetPermission: vi.fn(() => Promise.resolve(false)),
    primeDatasetPermissions: vi.fn(() => Promise.resolve(new Map())),
    primeMultipleDatasetPermissions: vi.fn(() => Promise.resolve(new Map())),
    setUnifiedTableState: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: (key) => key,
}));

vi.mock("../../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [],
}));

vi.mock("../../navigation/nav_engine/navigation_handler.js", () => ({
    handle_all_navigation: mocks.handleAllNavigation,
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "/",
    setParams: vi.fn(),
}));

vi.mock("./row_article_ui_handler.js", () => ({
    closeRowArticle: mocks.closeRowArticle,
}));

vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: mocks.hasDatasetPermission,
    primeDatasetPermissions: mocks.primeDatasetPermissions,
    primeMultipleDatasetPermissions: mocks.primeMultipleDatasetPermissions,
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    setUnifiedTableState: mocks.setUnifiedTableState,
}));

vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: vi.fn(),
}));

vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js", () => ({
    buildConfirmationMessage: vi.fn(() => ({
        messageLangKey: "delete_confirm",
        messagePlainText: "Delete?",
    })),
}));

import { buildRelatedTabs } from "./big_card_child_tabs.js";

describe("buildRelatedTabs related-record navigation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <div class="card_view_wrapper big-card-open">
                <div class="card_container">
                    <div class="card" data-id="42"></div>
                </div>
                <article class="active_row_article"></article>
            </div>
        `;
    });

    test("opens a related row without pushing an intermediate dataset base URL", async () => {
        const tabs = await buildRelatedTabs(
            [{
                dataset: "dev_agent_tasks",
                column: "parent_id",
                row_count: 1,
                rows: [{ id: 853, title: "Related task" }],
                types: { title: { card_element: "header" } },
            }],
            "dev_agent_task_todos",
            42,
            1,
        );

        document.querySelector(".active_row_article").appendChild(tabs);

        tabs.querySelector(".related_record_title_button").click();

        await vi.waitFor(() => {
            expect(mocks.handleAllNavigation).toHaveBeenCalledWith(
                "dev_agent_tasks",
                [],
                {
                    forceReload: true,
                    skipUrlUpdate: true,
                },
            );
        });

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith(
            "dev_agent_tasks",
            {
                cardView: { collapsed: true, expandedId: 853 },
            },
        );
        expect(mocks.closeRowArticle).toHaveBeenCalled();
    });

    test("renders related rows with compact columns and hides generated bridge relation tabs", async () => {
        const tabs = await buildRelatedTabs(
            [
                {
                    dataset: "dokumentaatio",
                    column: "palvelu_id",
                    row_count: 1,
                    rows: [{
                        id: 3,
                        otsikko: "Ohje salasanan vaihtoon",
                        created: "2026-06-15T21:36:00",
                        updated: "2026-06-15T21:50:00",
                    }],
                    types: { otsikko: { card_element: "header" } },
                },
                {
                    dataset: "palvelukatalogi_riskienhallinta_relation",
                    column: "palvelu_id",
                    row_count: 1,
                    rows: [{ palvelu_id: 1, riski_id: 2 }],
                },
            ],
            "palvelukatalogi",
            42,
            1,
        );

        const tabLabels = [...tabs.querySelectorAll(".related_tab_button")]
            .map((button) => button.textContent);
        expect(tabLabels).toEqual(["Dokumentaatio (1)", "comments"]);
        expect(tabs.querySelector('.related_tab_dataset_label')?.dataset.langKey)
            .toBe('dokumentaatio');

        const headerCells = [...tabs.querySelectorAll(".child_record_list_header_cell")]
            .map((cell) => cell.textContent);
        expect(headerCells).toEqual(["ID", "Nimi", "Luotu", "Muokattu"]);

        const summaryValues = [...tabs.querySelectorAll(".child_record_summary_value")]
            .map((cell) => cell.textContent);
        expect(summaryValues).toEqual([
            "3",
            "Ohje salasanan vaihtoon",
            displayDateTime("2026-06-15", "21:36"),
            displayDateTime("2026-06-15", "21:50"),
        ]);
        expect(tabs.textContent).not.toContain("palvelukatalogi_riskienhallinta_relation");
    });
});
