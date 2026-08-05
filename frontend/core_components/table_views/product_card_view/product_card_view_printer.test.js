// @vitest-environment jsdom
// product_card_view_printer.test.js
// Verifies product-card field inference, safe text rendering, and row-opening behavior.
// Bridges jsdom-rendered dataset rows with the product-card view module.
// Exists to keep the reusable product listing view stable before central view-key wiring.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    getLanguageWithBrowserFallbackMock,
    openRowArticleViewMock,
    refreshTableUnifiedMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    getLanguageWithBrowserFallbackMock: vi.fn(() => "en"),
    openRowArticleViewMock: vi.fn(),
    refreshTableUnifiedMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
}));

vi.mock("../card_view/row_article_opener.js", () => ({
    openRowArticleView: openRowArticleViewMock,
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: refreshTableUnifiedMock,
}));

import {
    create_product_card_view,
    refreshProductCardLanguages,
} from "./product_card_view_printer.js";

describe("product_card_view_printer", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        getLanguageWithBrowserFallbackMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReturnValue("en");
        localStorage.clear();
        openRowArticleViewMock.mockReset();
        refreshTableUnifiedMock.mockReset();
        refreshTableUnifiedMock.mockResolvedValue(undefined);
        setUnifiedTableStateMock.mockReset();
    });

    test("renders a dense card with inferred image, title, and product details", () => {
        const view = create_product_card_view(
            "products",
            [
                "id",
                "name",
                "cached_image",
                "price",
                "currency",
                "rating",
                "marketplace",
                "category",
            ],
            [
                {
                    id: 42,
                    name: "Noise Cancelling Headphones",
                    cached_image: "104_42_7.png",
                    price: "89.90",
                    currency: "EUR",
                    rating: "4.6",
                    marketplace: "Example Market",
                    category: "Audio",
                },
            ],
            {
                name: { data_type: "text" },
                cached_image: { data_type: "text" },
                price: { data_type: "numeric" },
                rating: { data_type: "numeric" },
                marketplace: { data_type: "text" },
                category: { data_type: "text" },
            }
        );

        const card = view.querySelector('[data-testid="product-card"]');
        const image = view.querySelector(".product-card-view-image");
        const title = view.querySelector('[data-testid="product-card-title"]');
        const details = Array.from(view.querySelectorAll(".product-card-view-detail"));

        expect(card?.dataset.rowId).toBe("42");
        expect(image?.getAttribute("src")).toBe("/storage/104/42/300/104_42_7.png");
        expect(image?.getAttribute("alt")).toBe("Noise Cancelling Headphones");
        expect(title?.textContent).toBe("Noise Cancelling Headphones");
        expect(details.map((detail) => detail.dataset.column)).toEqual([
            "price",
            "rating",
            "marketplace",
            "category",
        ]);
        expect(details[0]?.querySelector("dd")?.textContent).toBe("89.90 EUR");
        expect(details[1]?.querySelector("dd")?.textContent).toBe("4.6 / 5");
    });

    test("uses card metadata roles and keeps row values as text", () => {
        const unsafeTitle = '<img src=x onerror="window.bad=true">Product';
        const view = create_product_card_view(
            "catalog",
            ["id", "display_name", "hero_asset", "seller"],
            [
                {
                    id: 11,
                    display_name: unsafeTitle,
                    hero_asset: "/storage/demo-product.png",
                    seller: "Trusted Seller",
                },
            ],
            {
                display_name: {
                    card_element: "header",
                    data_type: "text",
                },
                hero_asset: {
                    card_element: "image",
                    data_type: "text",
                },
                seller: {
                    card_element: "details1",
                    data_type: "text",
                },
            }
        );

        const title = view.querySelector(".product-card-view-title");
        const image = view.querySelector(".product-card-view-image");

        expect(title?.textContent).toBe(unsafeTitle);
        expect(title?.querySelector("img")).toBeNull();
        expect(image?.getAttribute("src")).toBe("/storage/demo-product.png");
        expect(view.querySelector(".product-card-view-detail")?.dataset.column).toBe("seller");
    });

    test("switches to the normal card article view on click and keyboard activation", async () => {
        const row = {
            id: 5,
            title: "Keyboard Product",
            thumbnail: "104_5_1.png",
        };
        const view = create_product_card_view(
            "products",
            ["id", "title", "thumbnail"],
            [row],
            {}
        );

        const card = view.querySelector('[data-testid="product-card"]');
        card.click();

        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalled());
        expect(localStorage.getItem("products_view")).toBe("card");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("products", {
            cardView: {
                collapsed: true,
                expandedId: 5,
            },
        });
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("products", {
            skipUrlParams: true,
        });
        expect(openRowArticleViewMock).not.toHaveBeenCalled();

        refreshTableUnifiedMock.mockClear();
        setUnifiedTableStateMock.mockClear();
        card.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
        }));

        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalled());
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("products", {
            cardView: {
                collapsed: true,
                expandedId: 5,
            },
        });
    });

    test("renders a multilingual-ready empty state", () => {
        const view = create_product_card_view("products", ["id"], [], {});
        const emptyState = view.querySelector('[data-testid="product-card-empty"]');

        expect(emptyState?.textContent).toBe("No rows");
        expect(emptyState?.dataset.langKey).toBe("no_rows");
    });

    test("shows one language at a time and refreshes from unchanged raw row data", () => {
        const rawTitle = JSON.stringify({
            en: "Support service",
            fi: "Tukipalvelu",
        });
        const rawCategory = JSON.stringify({
            en: "Operations",
            fi: "Toiminta",
        });
        const row = {
            id: 17,
            name: rawTitle,
            category: rawCategory,
        };
        const view = create_product_card_view(
            "services",
            ["id", "name", "category"],
            [row],
            {
                name: { data_type: "text", is_multilingual: true },
                category: { data_type: "text", is_multilingual: true },
            }
        );
        document.body.appendChild(view);

        expect(view.querySelector(".product-card-view-title")?.textContent)
            .toBe("Support service");
        expect(view.querySelector(".product-card-view-detail-value")?.textContent)
            .toBe("Operations");

        refreshProductCardLanguages("fi");

        expect(view.querySelector(".product-card-view-title")?.textContent)
            .toBe("Tukipalvelu");
        expect(view.querySelector(".product-card-view-detail-value")?.textContent)
            .toBe("Toiminta");
        expect(row).toEqual({
            id: 17,
            name: rawTitle,
            category: rawCategory,
        });
    });

    test("preserves ordinary JSON when metadata explicitly disables multilingual rendering", () => {
        const ordinaryJson = JSON.stringify({ name: "Support service", count: 2 });
        const view = create_product_card_view(
            "services",
            ["id", "name"],
            [{ id: 18, name: ordinaryJson }],
            { name: { data_type: "jsonb", is_multilingual: false } }
        );

        expect(view.querySelector(".product-card-view-title")?.textContent)
            .toBe(ordinaryJson);
    });
});
