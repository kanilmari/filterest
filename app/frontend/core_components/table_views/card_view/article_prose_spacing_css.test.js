// @vitest-environment node
// article_prose_spacing_css.test.js
// Guards the owner's article reading rhythm: 1.6 line height and a 1.25em paragraph gap.
// Keeps dialog paragraphs on their own rule so only article prose changes.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { requireNodeDependency } from "../../../../server_tools/lib/node_dependency_loader.mjs";

const { parse } = requireNodeDependency("postcss");
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");

function declarations(root, selector) {
    const found = [];
    root.walkRules(rule => {
        if (rule.parent.type === "root" && rule.selector.replace(/\s+/g, " ").trim() === selector) {
            const values = {};
            rule.walkDecls(decl => { values[decl.prop] = decl.value; });
            found.push({ rule, values });
        }
    });
    return found;
}

test("article description text reads at 1.6 unless the site sets a body line height", () => {
    const [description] = declarations(parse(read("./cards_big.css")), ".big_description_value");
    expect(description.values["line-height"]).toBe("var(--body-line-height, 1.6)");
});

test("article paragraphs keep the description line height and a 1.25em gap after the dialog rule", () => {
    const root = parse(read("../../../reusable_components/modal/modals.css"));
    const [dialog] = declarations(root, ".modal p, .modal ul, .modal ol");
    const [prose] = declarations(root, ".big_description_value :is(p, ul, ol)");
    expect(dialog.values).toMatchObject({ "margin-bottom": "10px", "line-height": "1.4em" });
    expect(prose.values).toEqual({ "margin-bottom": "1.25em", "line-height": "inherit" });
    // Equal specificity: the article rule must come later to win inside article modals.
    expect(root.index(prose.rule)).toBeGreaterThan(root.index(dialog.rule));
    root.walkRules(rule => {
        if (rule !== prose.rule && /big_description_value (?:p|ul|ol)\b/.test(rule.selector)) {
            throw new Error(`article prose is styled twice: ${rule.selector}`);
        }
    });
});
