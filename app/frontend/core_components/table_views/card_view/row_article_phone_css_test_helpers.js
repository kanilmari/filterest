// row_article_phone_css_test_helpers.js
// Checks CSS ancestry rather than matching beyond a media block's closing brace.
// Connects article CSS contracts to the already installed PostCSS parser.
// Keeps the 700px viewport boundary explicit, including nested touch queries.
import { expect } from "vitest";
import { requireNodeDependency } from "../../../../server_tools/lib/node_dependency_loader.mjs";

const { parse } = requireNodeDependency("postcss");
const normalize = text => text.replace(/\s+/g, " ").trim();
const isPhone = node => node.type === "atrule" && node.name === "media"
    && node.params === "(width <= 700px)";

export function withoutPhone(css) {
    const root = parse(css);
    root.walkAtRules("media", rule => { if (isPhone(rule)) rule.remove(); });
    return root.toString();
}

export function expectPhoneRule(css, selector, declarations) {
    const matches = [];
    parse(css).walkRules(rule => {
        if (normalize(rule.selector) !== normalize(selector)) return;
        const values = Object.fromEntries(rule.nodes
            .filter(node => node.type === "decl").map(node => [node.prop, node.value]));
        if (!Object.entries(declarations).every(([key, value]) => values[key] === value)) return;
        matches.push(rule);
        const ancestors = [];
        for (let parent = rule.parent; parent; parent = parent.parent) ancestors.push(parent);
        expect(ancestors.some(isPhone), `${selector} must be inside the phone viewport gate`).toBe(true);
        expect(ancestors.some(node => node.name === "container"), "No container queries").toBe(false);
    });
    expect(matches.length, `Missing phone declarations for ${selector}`).toBeGreaterThan(0);
    return matches;
}
