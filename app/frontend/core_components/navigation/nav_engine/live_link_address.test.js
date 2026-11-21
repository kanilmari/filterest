// live_link_address.test.js
// Proves application links keep the page's address language and the catalogue's current names.
// Connects the address-language reader and the dataset catalogue's change notice to the links.
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ language: "", snapshot: true, listeners: [] }));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({
    getAddressLanguageParameter: () => mocks.language,
}));
vi.mock("./dataset_access_registry.js", () => ({
    hasDatasetAccessSnapshot: () => mocks.snapshot,
    subscribeDatasetAccessRegistry: listener => { mocks.listeners.push(listener); return () => {}; },
}));

import { asksBrowserToOpenElsewhere, bindLiveLinkAddress, withAddressLanguage } from "./live_link_address.js";

const notifyCatalogue = () => mocks.listeners.forEach(listener => listener());

beforeEach(() => {
    document.body.replaceChildren();
    mocks.language = "";
    mocks.snapshot = true;
});

describe("withAddressLanguage", () => {
    test("adds the page's address language and keeps the rest of the address", () => {
        expect(withAddressLanguage("/matkainfo/12-lapin-mokit")).toBe("/matkainfo/12-lapin-mokit");
        mocks.language = "en";
        expect(withAddressLanguage("/matkainfo/12-lapin-mokit")).toBe("/matkainfo/12-lapin-mokit?lang=en");
        expect(withAddressLanguage("/matkainfo/12?view=image_first_view")).toBe("/matkainfo/12?view=image_first_view&lang=en");
        expect(withAddressLanguage("/matkainfo?lang=fi")).toBe("/matkainfo?lang=fi");
    });
});

describe("bindLiveLinkAddress", () => {
    test("rewrites a link on the page when the catalogue changes, and when it is about to be used", () => {
        let name = "matkainfo";
        const link = document.createElement("a");
        document.body.append(link);
        bindLiveLinkAddress(link, () => withAddressLanguage(`/${name}`));
        expect(link.getAttribute("href")).toBe("/matkainfo");

        name = "travel";
        notifyCatalogue();
        expect(link.getAttribute("href")).toBe("/travel");

        mocks.language = "en";
        link.dispatchEvent(new FocusEvent("focus"));
        expect(link.getAttribute("href")).toBe("/travel?lang=en");
    });

    test("keeps an address while there is no catalogue, so no internal name reaches it", () => {
        let name = "matkainfo";
        const link = document.createElement("a");
        document.body.append(link);
        bindLiveLinkAddress(link, () => `/${name}`);
        mocks.snapshot = false;
        name = "app_matkainfo";
        notifyCatalogue();
        link.dispatchEvent(new PointerEvent("pointerdown"));
        expect(link.getAttribute("href")).toBe("/matkainfo");
    });

    test("a new link waits without an address until the catalogue arrives", () => {
        mocks.snapshot = false;
        const link = document.createElement("a");
        document.body.append(link);
        bindLiveLinkAddress(link, () => (mocks.snapshot ? "/matkainfo" : "/app_matkainfo"));
        expect(link.hasAttribute("href")).toBe(false);
        mocks.snapshot = true;
        notifyCatalogue();
        expect(link.getAttribute("href")).toBe("/matkainfo");
    });

    test("leaves anything other than a link alone", () => {
        const text = document.createElement("span");
        bindLiveLinkAddress(text, () => "/matkainfo");
        expect(text.hasAttribute("href")).toBe(false);
    });
});

describe("asksBrowserToOpenElsewhere", () => {
    test("only a modified press on a link with an address", () => {
        const link = document.createElement("a");
        link.setAttribute("href", "/matkainfo");
        const button = document.createElement("button");
        for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
            expect(asksBrowserToOpenElsewhere(new MouseEvent("click", { [modifier]: true }), link)).toBe(true);
            expect(asksBrowserToOpenElsewhere(new MouseEvent("click", { [modifier]: true }), button)).toBe(false);
        }
        expect(asksBrowserToOpenElsewhere(new MouseEvent("click"), link)).toBe(false);
    });
});
