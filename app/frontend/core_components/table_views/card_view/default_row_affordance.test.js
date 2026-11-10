// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const { readChoice } = vi.hoisted(() => ({ readChoice: vi.fn() }));

vi.mock("../row_presentation/row_presentation_choice.js", () => ({
    readRowOpeningChoice: readChoice,
    isRowPresentation: viewKey => ["article_view", "image_first_view", "image_first_page_view"].includes(viewKey),
}));

import { bindRowOpeningHref } from "./default_row_affordance.js";

const ordinaryHref = "/palvelukatalogi/24-design-the-services-people-can-rely-on?sort_order=ASC";

beforeEach(() => {
    readChoice.mockReset();
    history.replaceState({}, "", "/palvelukatalogi?view=card");
});

describe("bindRowOpeningHref", () => {
    test("keeps main's ordinary href while the permission snapshot is cold", () => {
        readChoice.mockReturnValue({ status: "pending", viewKey: null, source: null });
        const link = document.createElement("a");

        bindRowOpeningHref(link, ordinaryHref, "palvelukatalogi");

        expect(link.getAttribute("href")).toBe(ordinaryHref);
    });

    test("keeps main's ordinary href for a reader without row-presentation rights", () => {
        readChoice.mockReturnValue({ status: "denied", viewKey: null, source: null });
        const link = document.createElement("a");
        link.href = ordinaryHref;

        bindRowOpeningHref(link, ordinaryHref, "palvelukatalogi");
        link.dispatchEvent(new PointerEvent("pointerdown"));

        expect(link.getAttribute("href")).toBe(ordinaryHref);
    });

    test("pins the resolved authorized presentation to the href", () => {
        readChoice.mockReturnValue({ status: "resolved", viewKey: "image_first_view", source: "dataset" });
        const link = document.createElement("a");

        bindRowOpeningHref(link, ordinaryHref, "palvelukatalogi");

        expect(link.getAttribute("href")).toBe(`${ordinaryHref}&view=image_first_view`);
    });
});
