// row_article_task_todo_list_css.test.js
// Verifies ticket todo checkboxes stay native controls on the left of each row.
// Bridges the checklist CSS and the child-tab DOM contract.
// Exists so observatory mass-selection styles cannot replace ticket todo ticks.

import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "row_article_task_todo_list.css");
const importsPath = path.join(__dirname, "../../../styles/imports.css");
const css = fs.readFileSync(cssPath, "utf8");
const imports = fs.readFileSync(importsPath, "utf8");

function ruleBody(selectorPattern) {
    return css.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]+)\\}`, "s"))
        ?.groups?.body || "";
}

describe("row_article_task_todo_list.css", () => {
    test("keeps a native checkbox on the left of verbatim todo text", () => {
        const toggleRule = ruleBody("\\.row_article_task_todo_toggle");
        const checkboxRule = ruleBody("\\.row_article_task_todo_checkbox");

        expect(toggleRule).toContain("grid-template-columns: 1.15rem minmax(0, 1fr)");
        expect(checkboxRule).toContain("appearance: auto");
        expect(checkboxRule).toContain("cursor: pointer");
        expect(imports).toContain("row_article_task_todo_list.css");
        expect(css).not.toContain("workline-observatory");
    });

    test("tightens list-row gap and pretty-card padding and keeps phrase secondary", () => {
        const listRule = ruleBody("\\.row_article_task_todo_list(?:[^{]*)");
        const itemRule = ruleBody("\\.row_article_task_todo_item(?:[^{]*)");
        const phraseRule = ruleBody("\\.row_article_task_todo_phrase");
        const doneRule = ruleBody("\\.row_article_task_todo_item\\.is-done \\.row_article_task_todo_copy");

        expect(listRule).toContain("gap: 0.08rem");
        expect(itemRule).toContain("padding: 0.35rem 0.7rem");
        expect(phraseRule).toContain("font-size: 0.82em");
        expect(phraseRule).toContain("text_color_secondary");
        expect(doneRule).toContain("text-decoration: line-through");
        expect(css).not.toMatch(/\.row_article_task_todo_phrase[^{]*\{[^}]*text-decoration:\s*line-through/);
    });
});
