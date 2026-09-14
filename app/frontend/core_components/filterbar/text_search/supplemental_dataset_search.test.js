// @vitest-environment jsdom
// Exercises bounded background requests, stale cleanup and primary-first anchoring.
// Uses observable request lifetimes rather than a mirrored controller implementation.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ tabs: [], listener: null, reader: vi.fn() }));
vi.mock("../../navigation/main_tabs/main_dataset_tabs.js", () => ({
    getMainDatasetTabs: () => state.tabs,
    subscribeMainDatasetTabs: listener => { state.listener = listener; return () => { state.listener = null; }; },
}));
vi.mock("./dataset_search_response_reader.js", () => ({ readDatasetSearchResponse: state.reader }));
vi.mock("./supplemental_dataset_results.js", () => ({
    getSupplementalSearchCopy: () => ({ heading: "Others" }),
    createSupplementalDatasetGroup: tab => {
        const element = document.createElement("section"); element.dataset.dataset = tab.dataset;
        return { element, render: rows => { element.textContent = rows.map(row => row.id).join(","); } };
    },
}));
import { createSupplementalDatasetSearch } from "./supplemental_dataset_search.js";
let controls = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function mount(query = "shared", current = () => true) {
    const control = createSupplementalDatasetSearch("current", query, {
        isCurrent: current, getContainer: () => document.getElementById("stage"),
    });
    controls.push(control);
    return control;
}
beforeEach(() => {
    document.body.innerHTML = '<main id="tabs"><div id="current_container"><div id="stage"><div id="text">Primary text</div></div></div></main>';
    state.tabs = [{ dataset: "current" }, { dataset: "alpha" }, { dataset: "beta" }, { dataset: "gamma" }];
    state.reader.mockReset(); state.listener = null;
});
afterEach(async () => {
    controls.forEach(control => control.destroy()); controls = [];
    await tick(); await tick();
});
test("keeps at most two live requests across replacement generations and aborts pending work", async () => {
    let live = 0; let max = 0;
    state.reader.mockImplementation(async function* (_dataset, _query, options) {
        live += 1; max = Math.max(max, live);
        try {
            await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true }));
        } finally { live -= 1; }
        yield* []; // Aborted readers complete without result batches.
    });
    const first = mount();
    await tick(); expect(live).toBe(2);
    first.destroy();
    const next = mount("new");
    await tick(); await tick();
    expect(live).toBe(2); expect(max).toBe(2);
    next.destroy(); await tick(); await tick(); expect(live).toBe(0);
});
test("uses permitted tab order, three unique rows per dataset, and no current filters", async () => {
    state.reader.mockImplementation(async function* () {
        yield { columns: ["id"], types: {}, data: [{ id: 1 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
    });
    const control = mount(); await tick(); await tick();
    expect(Array.from(control.element.querySelectorAll("section")).map(el => el.dataset.dataset)).toEqual(["alpha", "beta", "gamma"]);
    expect(Array.from(control.element.querySelectorAll("section")).map(el => el.textContent)).toEqual(["1,2,3", "1,2,3", "1,2,3"]);
    for (const [dataset, query, options] of state.reader.mock.calls) {
        expect(dataset).not.toBe("current"); expect(query).toBe("shared");
        expect(options.filters).toBeUndefined(); expect(options.rowGroupSlug).toBeUndefined();
        expect(options).toMatchObject({ suppressAuthRedirect: true, suppressErrorToast: true });
    }
});
test("footer remains after delayed primary AI and after a replaced stage host", async () => {
    state.reader.mockImplementation(async function* () { yield { data: [{ id: 1 }] }; });
    const control = mount(); await tick();
    const ai = document.createElement("div"); ai.id = "primary-ai";
    document.getElementById("stage").append(ai); control.place();
    expect(document.getElementById("stage").lastElementChild).toBe(control.element);
    document.getElementById("stage").replaceChildren(ai); control.place();
    expect(document.getElementById("stage").lastElementChild).toBe(control.element);
});
test("clear and removed owner cancel requests, remove results and unsubscribe", async () => {
    const signals = [];
    state.reader.mockImplementation(async function* (_d, _q, options) {
        signals.push(options.signal);
        await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true }));
        yield* []; // Aborted readers complete without result batches.
    });
    const control = mount(); await tick();
    window.dispatchEvent(new CustomEvent("dataset-committed-search-changed", { detail: { dataset: "current", committed: false } }));
    await tick();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(control.element.isConnected).toBe(false);
    expect(state.listener).toBeNull();
    mount(); await tick(); document.getElementById("current_container").remove();
    await tick(); expect(signals.every(signal => signal.aborted)).toBe(true);
});
test("metadata reset rejects late rows while one background failure leaves other groups usable", async () => {
    let release;
    state.reader.mockImplementation(async function* (dataset) {
        if (dataset === "alpha") throw new Error("403");
        if (dataset === "beta") yield { data: [{ id: 2 }] };
        if (dataset === "gamma") { await new Promise(resolve => { release = resolve; }); yield { data: [{ id: 99 }] }; }
    });
    const control = mount(); await tick(); await tick();
    expect(control.element.textContent).toContain("2");
    state.listener([]);
    release(); await tick(); await tick();
    expect(control.element.textContent).not.toContain("99");
    expect(control.element.hidden).toBe(true);
});
test("empty query starts no background work", async () => {
    mount(" "); state.listener([{ dataset: "late" }]); await tick(); expect(state.reader).not.toHaveBeenCalled();
});

test("a late view host starts queued work on the executor placement callback", async () => {
    document.getElementById("stage").remove();
    state.reader.mockImplementation(async function* () { yield { data: [{ id: 1 }] }; });
    const control = mount(); await tick();
    expect(state.reader).not.toHaveBeenCalled();
    const stage = document.createElement("div"); stage.id = "stage";
    document.getElementById("current_container").append(stage);
    control.place(); await tick(); await tick();
    expect(state.reader).toHaveBeenCalledTimes(3);
    expect(stage.lastElementChild).toBe(control.element);
});

test("renderer switches retain completed matches without placement calls or new requests", async () => {
    state.reader.mockImplementation(async function* () {
        yield { data: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    });
    const control = mount(); await tick(); await tick();
    const rowsBefore = Array.from(control.element.querySelectorAll("section"));
    const queryCount = state.reader.mock.calls.length;
    for (const view of ["card", "table", "article_view"]) {
        const replacement = document.createElement("div");
        replacement.id = "stage";
        replacement.dataset.view = view;
        replacement.append(document.createElement("article"));
        document.getElementById("stage").replaceWith(replacement);
        await tick();
        expect(replacement.lastElementChild).toBe(control.element);
        expect(Array.from(control.element.querySelectorAll("section"))).toEqual(rowsBefore);
        expect(control.element.hidden).toBe(false);
        expect(state.reader).toHaveBeenCalledTimes(queryCount);
    }
});
test("pending matching search survives the temporary missing host during a renderer switch", async () => {
    state.tabs = [{ dataset: "other" }];
    let release;
    let signal;
    state.reader.mockImplementation(async function* (_dataset, _query, options) {
        signal = options.signal;
        await new Promise(resolve => { release = resolve; });
        yield { data: [{ id: 7 }] };
    });
    const control = mount(); await tick();
    document.getElementById("stage").remove();
    await tick();
    release(); await tick(); await tick();
    expect(signal.aborted).toBe(false);
    const replacement = document.createElement("div"); replacement.id = "stage";
    document.getElementById("current_container").append(replacement);
    await tick();
    expect(replacement.lastElementChild).toBe(control.element);
    expect(control.element.textContent).toContain("7");
    expect(state.reader).toHaveBeenCalledTimes(1);
});
test.each(["clear", "superseded", "deactivated"])("view mutations cannot resurrect %s search results", async mode => {
    state.reader.mockImplementation(async function* () { yield { data: [{ id: 9 }] }; });
    let current = true;
    const control = mount("old", () => current); await tick(); await tick();
    const count = state.reader.mock.calls.length;
    if (mode === "clear") {
        window.dispatchEvent(new CustomEvent("dataset-committed-search-changed", { detail: { dataset: "current", committed: false } }));
    } else if (mode === "superseded") current = false;
    else {
        document.getElementById("current_container").dispatchEvent(new CustomEvent("easelect:view-deactivate"));
        document.getElementById("current_container").classList.add("hidden");
    }
    const replacement = document.createElement("div"); replacement.id = "stage";
    document.getElementById("stage").replaceWith(replacement);
    await tick(); await tick();
    expect(replacement.contains(control.element)).toBe(false);
    expect(state.reader).toHaveBeenCalledTimes(count);
});
