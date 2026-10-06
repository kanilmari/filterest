// label_value_layout.test.js
// Verifies the shared site arrangements preserve content, link safety and absent labels.
// Connects the development boundary and public setting with existing renderer DOM.
// Protects the Stacked default when a stored choice is absent or unsupported.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { applyLabelValueLayout, normalizeLabelValueLayout, applySiteLabelValueLayoutSetting } from "./label_value_layout.js";

describe("shared field label/value layout", () => {
    beforeEach(() => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        document.body.innerHTML = '';
        delete document.documentElement.dataset.labelValueLayout;
    });
    afterEach(() => { document.head.innerHTML = ''; });
    const cases = JSON.parse(readFileSync('testing/shared_contracts/site_label_value_layout.json', 'utf8'));
    test.each(cases)("normalizes $value in $environment to $expected", ({ environment, value, expected }) => {
        document.querySelector('meta').content = environment;
        expect(normalizeLabelValueLayout(value)).toBe(expected);
    });
    test.each([undefined, null, "", "INLINE", "unknown", false, {}])(
        "defaults an absent or unsupported choice to Stacked: %s", setting => {
            const pair = document.createElement("div");
            pair.innerHTML = '<span>Label</span><span class="kv-dropped">Value</span>';
            expect(applyLabelValueLayout(pair, pair.firstChild, pair.lastChild, setting)).toBe(true);
            expect(pair.dataset.labelValueLayout).toBe('stacked');
            expect(pair.querySelector('.kv-dropped')).toBeNull();
        },
    );
    test.each(["auto", "inline", "stacked"])(
        "changes only arrangement for %s and preserves the existing safe link", (setting) => {
            const pair = document.createElement("div");
            pair.innerHTML = '<span lang="fi">Osoite</span><div data-raw-value="original"><a href="https://example.test" target="_blank" rel="noopener noreferrer">Open</a></div>';
            pair.style.display = "grid";
            const label = pair.firstChild;
            const value = pair.lastChild;
            const link = value.firstChild;
            value.className = "kv-dropped";
            value.style.marginLeft = "120px";
            expect(applyLabelValueLayout(pair, label, value, setting)).toBe(true);
            expect(pair.dataset.labelValueLayout).toBe(setting);
            expect(pair.firstChild).toBe(label);
            expect(pair.lastChild).toBe(value);
            expect(value.firstChild).toBe(link);
            expect(value.dataset.rawValue).toBe("original");
            expect(link.getAttribute("href")).toBe("https://example.test");
            expect(link.getAttribute("rel")).toBe("noopener noreferrer");
            expect(label.textContent).toBe("Osoite");
            expect(value.classList.contains("kv-dropped")).toBe(false);
            expect(value.style.marginLeft).toBe("");
        },
    );
    test("does not restore a deliberately hidden label", () => {
        const pair = document.createElement("div");
        const value = document.createElement("div");
        value.textContent = "Visible value";
        pair.append(value);
        applyLabelValueLayout(pair, null, value, "stacked");
        expect(pair.children).toHaveLength(1);
        expect(pair.classList.contains("label-value-layout--value-only")).toBe(true);
        expect(pair.querySelector(".label-value-layout__label")).toBeNull();
    });
});

describe('live site wrapping projection', () => {
    test.each(['stacked', 'inline'])('updates mounted and future pairs in %s while keeping hidden labels absent', mode => {
        document.body.replaceChildren();
        const pair = document.createElement('div');
        const value = document.createElement('span');
        value.textContent = 'Visible'; pair.append(value);
        applyLabelValueLayout(pair, null, value);
        document.body.append(pair);
        applySiteLabelValueLayoutSetting(mode);
        expect(pair.dataset.labelValueLayout).toBe(mode);
        expect(pair.children).toHaveLength(1);
        const future = document.createElement('div');
        future.append(document.createElement('span'));
        applyLabelValueLayout(future, null, future.firstChild);
        expect(future.dataset.labelValueLayout).toBe(mode);
        expect(future.classList.contains('label-value-layout--value-only')).toBe(true);
    });
});
