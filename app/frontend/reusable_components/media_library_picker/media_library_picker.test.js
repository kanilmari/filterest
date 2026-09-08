/* @vitest-environment jsdom */
// Tests the in-form existing-image selector without any real content writes.
// Between bounded API responses, draft state, and translated form controls.
// Protects stale-response handling and the no-download/no-reupload contract.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { appendMediaLibraryPicker, mediaLibraryText } from "./media_library_picker.js";

beforeEach(() => document.body.replaceChildren());
function mount(endpointRouter, lang = "en") {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.required = true;
    const state = { _fileRequiredWhenEmpty: true, _actualFileObjects: [new File(["x"], "old.png")] };
    const selectedFiles = document.createElement("div");
    const control = appendMediaLibraryPicker(host, {
        relationId: 17, state, fileInput, selectedFiles, endpointRouter, getLanguage: () => lang,
    });
    return { host, state, fileInput, control };
}
const result = { items: [{ source_row_id: 9, name: "Stored image", url: "/storage/101/1/original/101_1_9.png" }], next_after: 0 };
describe("existing images", () => {
    test.each(["en", "fi"])("selects IDs in %s without fetching image bytes or submitting a row", async (lang) => {
        const api = vi.fn().mockResolvedValue(result);
        const { host, state, fileInput } = mount(api, lang);
        host.querySelector('[data-testid="existing-image-picker-open"]').click();
        await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
        host.querySelector("img").closest("button").click();
        expect(state._existingImage).toEqual({ relation_id: 17, source_row_id: 9 });
        expect(state._actualFileObjects).toEqual([]);
        expect(fileInput.required).toBe(false);
        expect(api).toHaveBeenCalledTimes(1);
        expect(api.mock.calls[0][0]).toBe("mediaLibraryList");
        const clear = [...host.querySelectorAll("button")].find((b) => b.textContent === mediaLibraryText("clear", () => lang));
        clear.click();
        expect(state._existingImage).toBeUndefined();
        expect(fileInput.required).toBe(true);
    });
    test("shows a meaningful permission failure without exposing server text", async () => {
        const { host } = mount(vi.fn().mockRejectedValue(new Error("private SQL details")), "fi");
        host.querySelector("button").click();
        await vi.waitFor(() => expect(host.textContent).toContain("näillä oikeuksilla"));
        expect(host.textContent).not.toContain("private SQL");
    });
    test("ignores a delayed response after the selector closes", async () => {
        let finish;
        const { host } = mount(vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })));
        const toggle = host.querySelector("button");
        toggle.click(); toggle.click(); finish(result);
        await Promise.resolve(); await Promise.resolve();
        expect(host.querySelector("img")).toBeNull();
    });
    test("refuses remote URLs and invalid source identities in metadata", async () => {
        const { host } = mount(vi.fn().mockResolvedValue({ items: [
            { source_row_id: 9, name: "<script>", url: "https://remote/image.png" },
            { source_row_id: -1, name: "x", url: "/storage/x" },
        ] }));
        host.querySelector("button").click();
        await vi.waitFor(() => expect(host.textContent).toContain("No reusable images"));
        expect(host.querySelector("img")).toBeNull();
    });
});
