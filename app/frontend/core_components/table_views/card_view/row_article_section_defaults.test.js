// row_article_section_defaults.test.js
// Verifies per-opening settings, supported sections and local disclosure state.
// Exercises the stable read boundary without saving a preference or requesting data.
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const getDefaults = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/stable_endpoint_router.js", () => ({
    getArticleSectionDefaults: getDefaults,
}));
import {
    loadRowArticleSectionDefaults, resolveRowArticleSectionStartOpen,
} from "./row_article_section_defaults.js";

beforeEach(() => { getDefaults.mockReset(); });

test("loads classic effective booleans once per call and never caches a later opening", async () => {
    getDefaults.mockResolvedValueOnce({
        dataset: "events", presentation_key: "classic",
        initial_open: { details: false, images: false, attachments: true, unrelated: false },
    }).mockResolvedValueOnce({ dataset: "events", presentation_key: "classic", initial_open: { details: true } });
    const first = await loadRowArticleSectionDefaults("events", "classic");
    expect(first).toEqual({ details: false, images: false, attachments: true, related_rows: true, task_progress: true });
    expect(Object.isFrozen(first)).toBe(true);
    expect((await loadRowArticleSectionDefaults("events", "classic")).details).toBe(true);
    expect(getDefaults.mock.calls).toEqual([["events", "classic"], ["events", "classic"]]);
});

test("image-first accepts only its supported details section", async () => {
    getDefaults.mockResolvedValue({ dataset: "events", presentation_key: "image_first",
        initial_open: { details: false, images: false, task_progress: false } });
    expect(await loadRowArticleSectionDefaults("events", "image_first")).toEqual({ details: false });
});

test.each([
    { dataset: "other", presentation_key: "classic", initial_open: { details: false } },
    { dataset: "events", presentation_key: "image_first", initial_open: { details: false } },
    { dataset: "events", presentation_key: "classic", initial_open: { details: "false" } },
])("mismatched or malformed settings retain existing open defaults", async response => {
    getDefaults.mockResolvedValue(response);
    expect((await loadRowArticleSectionDefaults("events", "classic")).details).toBe(true);
});

test("a settings read failure keeps content available with the established default", async () => {
    getDefaults.mockRejectedValue(new Error("403"));
    expect(await loadRowArticleSectionDefaults("events", "image_first")).toEqual({ details: true });
});

test("current user disclosure state wins over either initial boolean", () => {
    const section = document.createElement("section");
    section.dataset.disclosureState = "expanded";
    expect(resolveRowArticleSectionStartOpen({ images: false }, "images", section)).toBe(true);
    section.dataset.disclosureState = "collapsed";
    expect(resolveRowArticleSectionStartOpen({ images: true }, "images", section)).toBe(false);
    expect(resolveRowArticleSectionStartOpen({}, "images")).toBe(true);
});
