// supplemental_dataset_search.js
// Coordinates bounded read-only searches in the current permitted main-tab datasets.
// Connects the shared tab snapshot and streamed endpoint to compact localized result groups.
// Owns cancellation, two actual concurrent requests, and a footer after all primary search stages.

import { getMainDatasetTabs, subscribeMainDatasetTabs } from "../../navigation/main_tabs/main_dataset_tabs.js";
import { readDatasetSearchResponse } from "./dataset_search_response_reader.js";
import { createSupplementalDatasetGroup, getSupplementalSearchCopy } from "./supplemental_dataset_results.js";
import { bindDatasetLanguageRenderer } from "../../table_views/dataset_value_localizer.js";
import { VIEW_DEACTIVATE_EVENT } from "../../../reusable_components/view_lifecycle_events.js";

// Shared across generations: replacement searches wait until aborted requests settle.
const queue = [];
let activeRequests = 0;
function pump() {
    while (activeRequests < 2 && queue.length) {
        const task = queue.shift();
        if (task.signal.aborted) { task.resolve(); continue; }
        activeRequests += 1;
        Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
            activeRequests -= 1;
            pump();
        });
    }
}
function schedule(run, signal) {
    return new Promise((resolve, reject) => {
        queue.push({ run, signal, resolve, reject });
        pump();
    });
}

export function createSupplementalDatasetSearch(tableName, query, { isCurrent, getContainer }) {
    query = String(query).trim();
    const host = document.createElement("section");
    host.className = "supplemental-dataset-results";
    host.dataset.sourceDataset = tableName;
    host.hidden = true;
    const heading = document.createElement("h2");
    bindDatasetLanguageRenderer(heading, language => {
        heading.textContent = getSupplementalSearchCopy(language).heading;
    });
    const groups = document.createElement("div");
    host.append(heading, groups);
    const owner = document.getElementById(tableName + "_container");
    let destroyed = false;
    let generation = 0;
    let snapshot = null;
    let entries = [];
    const connected = () => !destroyed && isCurrent() && Boolean(getContainer()?.isConnected);
    const searchActive = () => Boolean(query) && !destroyed && isCurrent()
        && (!owner || owner.isConnected) && !owner?.classList.contains("hidden");
    const active = () => searchActive() && connected();

    function placeHost() {
        if (!connected()) return;
        const container = getContainer();
        if (container.lastElementChild !== host) container.append(host);
    }
    function stopRequests() {
        generation += 1;
        for (const entry of entries) {
            entry.controller?.abort();
            entry.controller = null;
        }
    }
    async function searchEntry(entry, expectedGeneration) {
        const controller = new AbortController();
        entry.controller = controller;
        const current = () => searchActive() && generation === expectedGeneration && !controller.signal.aborted;
        try {
            await schedule(async () => {
                if (!current()) return;
                for await (const packet of readDatasetSearchResponse(entry.tab.dataset, query, {
                    signal: controller.signal, suppressAuthRedirect: true, suppressErrorToast: true,
                }, current)) {
                    if (!current()) return;
                    if (packet.columns?.length) entry.columns = packet.columns;
                    Object.assign(entry.types, packet.types || {});
                    for (const row of packet.data || []) {
                        if (row.id == null || entry.ids.has(String(row.id))) continue;
                        entry.ids.add(String(row.id));
                        entry.rows.push(row);
                        if (entry.rows.length === 3) break;
                    }
                    entry.group.render(entry.rows, entry.columns, entry.types);
                    host.hidden = !entries.some(item => item.rows.length);
                    placeHost();
                    if (entry.rows.length >= 3) { entry.complete = true; break; }
                }
                if (current()) entry.complete = true;
            }, controller.signal);
        } catch (error) {
            // Optional background results never replace/redirect the current page.
            if (current()) entry.complete = true;
        } finally {
            if (entry.controller === controller) entry.controller = null;
        }
    }
    function resume() {
        if (!active()) return;
        placeHost();
        for (const entry of entries) {
            if (!entry.complete && !entry.controller) void searchEntry(entry, generation);
        }
    }
    function setTargets(tabs) {
        if (destroyed || tabs === snapshot) return;
        stopRequests();
        snapshot = tabs;
        groups.replaceChildren();
        entries = tabs.filter(tab => tab.dataset !== tableName).map(tab => {
            const group = createSupplementalDatasetGroup(tab, query);
            groups.append(group.element);
            return { tab, group, rows: [], ids: new Set(), columns: [], types: {}, complete: false, controller: null };
        });
        host.hidden = true;
        resume();
    }
    function onCommittedChange(event) {
        if (event.detail?.dataset === tableName && !event.detail.committed) destroy();
    }
    function onDeactivate() { stopRequests(); }
    const observer = new MutationObserver(records => {
        if (owner && !owner.isConnected) { destroy(); return; }
        if (!searchActive()) { stopRequests(); return; }
        // A renderer switch replaces only the inner view. Move the existing
        // result host when its successor appears; completed requests stay cached.
        // Ignore our own row/copy updates and never reappend an already-last host.
        if (records.some(record => record.target === owner
            || (record.type === "childList" && !host.contains(record.target)))) resume();
    });
    if (owner) observer.observe(owner, {
        attributes: true, attributeFilter: ["class"], childList: true, subtree: true,
    });
    if (owner?.parentElement) observer.observe(owner.parentElement, { childList: true });
    owner?.addEventListener(VIEW_DEACTIVATE_EVENT, onDeactivate);
    window.addEventListener("dataset-committed-search-changed", onCommittedChange);
    const unsubscribe = subscribeMainDatasetTabs(setTargets);
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        stopRequests();
        unsubscribe();
        observer.disconnect();
        owner?.removeEventListener(VIEW_DEACTIVATE_EVENT, onDeactivate);
        window.removeEventListener("dataset-committed-search-changed", onCommittedChange);
        host.remove();
    }
    if (String(query).trim()) setTargets(getMainDatasetTabs());
    return { place: resume, destroy, element: host };
}
