// row_article_image_controls_css.test.js
// Guards inherited image-arrow colours, fixed icon geometry and interaction isolation.
// Connects all three gallery surfaces to theme-local aliases of existing greys.
// Prevents invisible borders, opacity/blur skins and hover rules from masking disabled state.
import fs from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { expectPhoneRule, withoutPhone } from "./row_article_phone_css_test_helpers.js";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const controls = read("./row_article_image_controls.css");
const variables = read("../../../styles/variables.css");

// Follow the shipped entrypoint, including nested imports, in cascade order.
// JSDOM preserves var() references; C22 checks the browser-resolved RGB values.
function readCascade(relativePath, base = import.meta.url) {
    const url = new URL(relativePath, base);
    return fs.readFileSync(url, "utf8").replace(
        /@import\s+url\(["']([^"']+)["']\);/g,
        (_, relative) => readCascade(relative, url),
    );
}
const fullCascade = readCascade("../../../styles/imports.css");
const enabledHover = fullCascade.match(/\.fw-btn:hover:not\(:disabled\)\s*\{[^}]*\}/)[0];
const disabledBorderProbe = "rgb(101, 102, 103)";
const surfaces = [
    ["IFAV", "modal_overlay_blur image-modal-controls-active", "image_modal image_first_view_modal", "row_article_image_first_arrow"],
    ["touch-idle IFAV", "modal_overlay_blur", "image_modal image_first_view_modal", "row_article_image_first_arrow"],
    ["classic inline media", "", "row_article_inline_media", "row_article_image_first_arrow"],
    ["thumbnail carousel", "", "big_card_thumbnail_row", "big_card_thumbnail_carousel_button"],
];
const classicMarkup = `<div class="big_card_image"><div class="row_article_inline_media">
    <div class="wrapper card_photo_presentation"><img></div>
    <button class="row_article_image_first_arrow fw-btn fw-btn--ghost">
        <span class="row_article_image_arrow_icon"></span>
    </button>
</div></div>`;

function surfaceMarkup(overlayClass, rootClass, arrowClass) {
    return `<div class="${overlayClass}"><div class="${rootClass}">
        <button disabled class="${arrowClass} fw-btn fw-btn--ghost">
            <span class="row_article_image_arrow_icon"></span>
        </button>
        <button class="${arrowClass} fw-btn fw-btn--ghost">
            <span class="row_article_image_arrow_icon"></span>
        </button>
    </div></div>`;
}

const fixtureStates = ["light", "dark"].flatMap(theme =>
    ["rest", "hover"].flatMap(state =>
        ["body", "root class", "root attribute"].map(themeScope => ({ theme, state, themeScope }))));
const simulateHover = css => css.replace(/:hover\b/g, ".test-hover");

// Use the same theme, tree and interaction setup for filtering and assertions.
// Separate theme scopes also preserve selectors that require an unthemed root/body.
function populateSurface(fixture, { theme, state, themeScope }, classes) {
    fixture.body.innerHTML = surfaceMarkup(...classes);
    const themeRoot = themeScope === "body" ? fixture.body : fixture.documentElement;
    if (themeScope === "root attribute") themeRoot.dataset.theme = theme;
    else themeRoot.className = `${theme}-mode`;
    if (state === "hover") fixture.querySelectorAll("button")
        .forEach(button => button.classList.add("test-hover"));
}

// Parse the full cascade once, outside the timed tests. Keep every rule that
// can affect a fixture (including global/ancestor rules) in its original order.
// Re-parsing unrelated application CSS in each jsdom fixture took seconds.
function createProbe() {
    const probe = document.implementation.createHTMLDocument();
    const style = probe.createElement("style");
    // The assertion fixtures have a nonempty style node too (:empty/:has()).
    style.textContent = "/* cascade */";
    probe.head.replaceChildren(style);
    return probe;
}
const classicProbe = createProbe();
classicProbe.body.innerHTML = classicMarkup;
const probes = [
    { fixture: classicProbe, transform: selector => selector },
    ...fixtureStates.flatMap(fixtureState => surfaces.map(([, ...classes]) => {
        // Keep trees separate so :only-child, :has(), etc. see the real fixture.
        const fixture = createProbe();
        populateSurface(fixture, fixtureState, classes);
        return { fixture, transform: simulateHover };
    })),
];
const sheet = new CSSStyleSheet();
sheet.replaceSync(fullCascade);
function matchingRules(rules) {
    return Array.from(rules, rule => {
        if (!rule.selectorText && rule.cssRules) {
            const children = matchingRules(rule.cssRules);
            return children ? `${rule.cssText.slice(0, rule.cssText.indexOf("{") + 1)}${children}}` : "";
        }
        if (!rule.selectorText) return rule.cssText;
        try {
            return probes.some(({ fixture, transform }) => fixture.querySelector(transform(rule.selectorText)))
                ? rule.cssText : "";
        } catch {
            // Retain selectors the query engine cannot classify, conservatively.
            return rule.cssText;
        }
    }).join("\n");
}
const cascade = matchingRules(sheet.cssRules);

afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.body.className = "";
});

describe("article image arrow CSS", () => {
    test("keeps revealed classic arrows above the isolated image and able to receive pointers", () => {
        const style = document.createElement("style");
        style.textContent = cascade;
        document.head.append(style);
        document.body.innerHTML = classicMarkup;
        const media = getComputedStyle(document.querySelector(".row_article_inline_media"));
        const image = getComputedStyle(document.querySelector(".wrapper"));
        const button = getComputedStyle(document.querySelector("button"));
        expect(media.position).toBe("relative");
        expect(media.isolation).toBe("isolate");
        expect(image.position).toBe("relative");
        expect(image.isolation).toBe("isolate");
        expect(["", "auto"]).toContain(image.zIndex);
        expect(button.position).toBe("absolute");
        expect(Number(button.zIndex)).toBeGreaterThan(0);
        expect(button.pointerEvents).toBe("auto");
        expect(getComputedStyle(document.querySelector("img")).pointerEvents).toBe("auto");
        expect(getComputedStyle(document.querySelector("span")).pointerEvents).toBe("none");
        // JSDOM does not apply hover media queries. C22 verifies real hit testing
        // after entering the media, and checks :hover on the arrow itself.
    });

    for (const fixtureState of fixtureStates) {
        const { theme, state, themeScope } = fixtureState;
        test.each(surfaces)(`keeps arrow colours in the full ${theme} ${state} cascade (${themeScope}): %s`,
            (_name, overlayClass, rootClass, arrowClass) => {
                // Isolate selector caches between fixtures, especially body :is() matches.
                const frame = document.createElement("iframe");
                document.body.append(frame);
                const context = frame.contentWindow;
                const fixture = context.document;
                const style = fixture.createElement("style");
                // JSDOM has no pointer: activate the shipped hover selectors with a class.
                // It also misranks later :is() rules: replay the more specific framework hover last.
                // Its var() border shorthands lack longhands: substitute only the edge alias.
                // The binding guard below and C22 verify the actual theme-derived colour.
                style.textContent = simulateHover(`${cascade}\n${state === "hover" ? enabledHover : ""}`)
                    .replaceAll("var(--control-disabled-border)", disabledBorderProbe);
                fixture.head.append(style);
                populateSurface(fixture, fixtureState, [overlayClass, rootClass, arrowClass]);
                const disabled = fixture.querySelector("button:disabled");
                const enabled = fixture.querySelector("button:enabled");
                const disabledIcon = context.getComputedStyle(disabled.firstElementChild).backgroundColor;
                const enabledIcon = context.getComputedStyle(enabled.firstElementChild).backgroundColor;
                const disabledStyle = context.getComputedStyle(disabled);
                expect(disabledStyle.color).toBe("var(--control-disabled-text)");
                for (const side of ["Top", "Right", "Bottom", "Left"]) {
                    expect(disabledStyle[`border${side}Color`]).toBe(disabledBorderProbe);
                    expect(disabledStyle[`border${side}Style`]).toBe("solid");
                    expect(parseFloat(disabledStyle[`border${side}Width`])).toBeGreaterThanOrEqual(1);
                }
                expect(disabledIcon).toBe("var(--control-disabled-text)");
                expect(disabledIcon).not.toBe(enabledIcon);
                const enabledColor = context.getComputedStyle(enabled).color;
                expect(enabledIcon).toBe(enabledColor);
                if (state === "hover") expect(enabledColor).toBe("var(--fw-color-primary)");
            });
    }

    test("recomputes all disabled aliases for explicit app themes over either OS preference", () => {
        const blocks = [
            variables.match(/:root\s*\{([^}]*)/s)?.[1],
            variables.match(/body\.light-mode,\s*body\.dark-mode\s*\{([^}]*)/s)?.[1],
        ];
        for (const block of blocks) {
            expect(block).toContain("--control-disabled-bg: var(--table_border_color)");
            expect(block).toContain("--control-disabled-text: var(--border_color)");
            expect(block).toContain("--control-disabled-border: var(--border_color)");
        }
    });

    test("keeps the disabled skin opaque and stationary above 700px", () => {
        expect(controls).toMatch(/\.row_article_image_arrow_icon\s*\{[^}]*flex:\s*0 0 2rem;[^}]*width:\s*2rem;[^}]*height:\s*2rem;/s);
        expect(controls).toContain(".image_modal.image_first_view_modal, .row_article_inline_media, .big_card_thumbnail_row");
        expect(controls).toContain(":is(.row_article_image_first_arrow, .big_card_thumbnail_carousel_button):disabled");
        for (const declaration of [
            "background: var(--control-disabled-bg)", "color: var(--control-disabled-text)",
            "border: 1px solid var(--control-disabled-border)", "box-shadow: none", "filter: none",
            "backdrop-filter: none", "cursor: not-allowed",
        ]) expect(controls).toContain(declaration);
        // Idle visibility belongs to each view; disabled skins must not override it.
        expect(withoutPhone(controls)).not.toMatch(/opacity\s*:/);
        expect(read("./big_card_image_gallery.css")).not.toMatch(/\.row_article_image_first_arrow:disabled\s*\{/);
        expect(read("../../../reusable_components/modal/modals.css"))
            .not.toMatch(/[^{}]*row_article_image_first_arrow[^{}]*:disabled\s*\{/);
        expect(read("../../../styles/framework.css")).toContain(".fw-btn--ghost:hover:not(:disabled)");
        expect(read("../../../styles/framework.css")).not.toContain(".fw-btn--ghost:hover {");
    });

    test("dims only revealed disabled phone arrows without defeating idle, hover or touch visibility", () => {
        const alpha = "var(--row-article-image-arrow-visible-alpha, 1)";
        expectPhoneRule(controls,
            ":is(.row_article_image_first_arrow, .big_card_thumbnail_carousel_button):disabled",
            { "--row-article-image-arrow-visible-alpha": "0.5" });
        expect(controls.match(/--row-article-image-arrow-visible-alpha\s*:/g)).toHaveLength(1);
        expectPhoneRule(controls,
            ".row_article_inline_media .row_article_image_first_arrow, .big_card_thumbnail_row .big_card_thumbnail_carousel_button",
            { opacity: alpha });
        expectPhoneRule(controls,
            "body .modal_overlay_blur.image-modal-controls-active .image_modal .row_article_image_first_arrow, body .image_modal .row_article_image_first_arrow:focus-visible",
            { opacity: alpha });
        const [touch] = expectPhoneRule(controls,
            "body .modal_overlay_blur .image_modal .row_article_image_first_arrow", { opacity: alpha });
        expect(touch.parent.params).toBe("(hover: none), (pointer: coarse)");
        expect(touch.parent.parent.params).toBe("(width <= 700px)");
        // No phone opacity override for an inactive fine-pointer modal; its zero survives.
        expect(controls).not.toMatch(/body \.image_modal \.row_article_image_first_arrow\s*\{/);
        expect(read("../../../reusable_components/modal/modals.css"))
            .toMatch(/\.image_modal :is\([^)]*\.row_article_image_first_arrow[^)]*\)\s*\{\s*opacity: 0;/s);
        expect(read("./row_article_inline_media.css"))
            .toMatch(/@media \(hover: hover\)\s*\{[^}]*:not\(:hover, :focus-within\)[^}]*opacity: 0;/s);
    });
});
