// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const { readChoice, snapshot } = vi.hoisted(() => ({ readChoice: vi.fn(), snapshot: { present: false } }));

vi.mock("../../navigation/nav_engine/dataset_access_registry.js", async importOriginal => ({
    ...await importOriginal(),
    hasDatasetAccessSnapshot: () => snapshot.present,
}));

vi.mock("../row_presentation/row_presentation_choice.js", () => ({
    readRowOpeningChoice: readChoice,
    isRowPresentation: viewKey => ["article_view", "image_first_view", "image_first_page_view"].includes(viewKey),
}));

import { bindRowOpeningHref } from "./default_row_affordance.js";

const ordinaryHref = "/palvelukatalogi/24-design-the-services-people-can-rely-on?sort_order=ASC";

beforeEach(() => {
    readChoice.mockReset();
    // The dataset catalogue has loaded, as it has before any card is drawn.
    snapshot.present = true;
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

    test("pins the reader's own presentation to the href", () => {
        readChoice.mockReturnValue({ status: "resolved", viewKey: "image_first_view", source: "user" });
        const link = document.createElement("a");

        bindRowOpeningHref(link, ordinaryHref, "palvelukatalogi");

        expect(link.getAttribute("href")).toBe(`${ordinaryHref}&view=image_first_view`);
    });

    test.each(["dataset", "site", "classic"])("leaves a %s default out of the href: the plain address opens it", source => {
        readChoice.mockReturnValue({ status: "resolved", viewKey: "image_first_view", source });
        const link = document.createElement("a");

        bindRowOpeningHref(link, `${ordinaryHref}&view=image_first_view`, "palvelukatalogi");

        expect(link.getAttribute("href")).toBe(ordinaryHref);
    });

    test("reads a function address again when the link is about to be used", () => {
        readChoice.mockReturnValue({ status: "pending", viewKey: null, source: null });
        let address = "/palvelukatalogi/24-old-words";
        const link = document.createElement("a");

        bindRowOpeningHref(link, () => address, "palvelukatalogi");
        address = "/palvelut/24-old-words";
        link.dispatchEvent(new PointerEvent("pointerdown"));

        expect(link.getAttribute("href")).toBe("/palvelut/24-old-words");
    });
});
