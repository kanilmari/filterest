// @vitest-environment node
// row_article_record_bar_css.test.js
// Checks the bar's visibility, scroll flow and theme-safe cell styling.
// Connects the shipped CSS import and scroll owner to the record-bar contract.
// Keeps the all-width layout contract verifiable without launching a browser.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { requireNodeDependency } from "../../../../server_tools/lib/node_dependency_loader.mjs";
const { parse } = requireNodeDependency("postcss");
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("./row_article_record_bar.css");
const root = parse(css);
const declarations = selector => {
    const result = {};
    root.walkRules(selector, rule => rule.walkDecls(decl => { result[decl.prop] = decl.value; }));
    return result;
};
describe("record bar CSS", () => {
    test("is visible above the article title at every width", () => {
        expect(read("../../../styles/imports.css")).toContain("card_view/row_article_record_bar.css");
        expect(declarations(".row_article_record_bar").display).toBe("flex");
        root.walkRules(".row_article_record_bar", rule => expect(rule.parent.type).toBe("root"));
    });
    test("scrolls with content and never uses fixed or sticky positioning", () => {
        const cards = parse(read("./cards_big.css"));
        const scroll = [];
        cards.walkRules(".big_card_content", rule => rule.walkDecls("overflow", decl => scroll.push(decl.value)));
        expect(scroll).toContain("hidden auto");
        root.walkDecls("position", decl => expect(["fixed", "sticky"]).not.toContain(decl.value));
        // E11 measures the title from the bar's bottom, so the bar's outer height is pinned here.
        expect(declarations(".row_article_record_bar")).toMatchObject({ height: "44px", "box-sizing": "border-box", "flex": "0 0 auto" });
    });
    test("uses equal 44px cells, dividers, 20px icons and application theme variables", () => {
        expect(declarations(".row_article_record_bar .row_article_record_bar_cell")).toMatchObject({
            flex: "1 1 0", height: "44px", "min-height": "44px", "font-size": "15px", "font-weight": "600",
            "border-inline-end": "1px solid var(--border_color)", color: "var(--text_color)",
        });
        expect(declarations(".row_article_record_bar")).toMatchObject({
            background: "var(--filter_panel_bg_color)", "border-bottom": "1px solid var(--border_color)",
        });
        root.walkRules(rule => {
            if (!rule.selector.includes(".row_article_record_bar_icon")) return;
            const values = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]));
            expect(values).toMatchObject({ flex: "0 0 20px", width: "20px", height: "20px" });
        });
        expect(declarations(".row_article_record_bar .row_article_record_bar_cell:disabled").opacity).toBe("0.52");
        expect(declarations(".row_article_record_bar .row_article_record_bar_cell:focus-visible").outline).toBe("2px solid var(--primary_color)");
    });
    test("reaches the tight 4px gap and 6px padding at 340px and below without an extra media query", () => {
        const cell = declarations(".row_article_record_bar .row_article_record_bar_cell");
        expect(cell.gap).toBe("clamp(4px, calc(4px + (100vw - 340px) * 0.04), 6px)");
        expect(cell.padding).toBe("0 clamp(6px, calc(6px + (100vw - 340px) * 0.12), 12px)");
    });
});
