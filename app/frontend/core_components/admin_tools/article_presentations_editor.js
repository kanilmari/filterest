// article_presentations_editor.js
// Hosts the article adapter inside the existing field-settings workflow.
// Connects actual site/group targeting, external actions and metadata intents.
// A context switch preserves its version-2 draft and ignores late responses.
import { createArticlePresentationsTable, readArticlePresentations, articleGroupsDiffer } from './article_presentations_table.js';
import { articleOrdersDiffer, validateArticleSnapshot } from './article_presentations_state.js';
import { getArticlePresentationsCopy } from './article_presentations_copy.js';

export function createArticlePresentationsEditor({ host, nameInput, priorityInput, priorityRow, saveButton,
    cancelButton, restoreButton, status, targetStatus, targetCopy, language, onBusy = () => {} }) {
    let adapter = null, generation = 0, active = false, busy = false;
    let copy = getArticlePresentationsCopy(language), lastContext = null;
    const events = new AbortController();
    function notice(value) { status.hidden = !value; status.textContent = value; delete status.dataset.langKey; }
    function sync() {
        if (!active) return;
        const metadata = adapter?.table.getChangeSet().metadata || {};
        const invalidName = Object.hasOwn(metadata, 'name') && !metadata.name;
        const invalidPriority = priorityInput.value !== '' && (!Number.isSafeInteger(Number(priorityInput.value)) || Math.abs(Number(priorityInput.value)) > 1000000);
        saveButton.disabled = busy || !adapter || adapter.isBlocked() || !adapter.table.isDirty() || invalidName || invalidPriority;
        restoreButton.disabled = busy || !adapter || adapter.isBlocked();
        cancelButton.disabled = busy;
        nameInput.disabled = busy || !adapter || adapter.isBlocked();
        priorityInput.disabled = nameInput.disabled;
    }
    nameInput.addEventListener('input', () => { if (active && adapter) { adapter.metadata({ name: nameInput.value.trim() }); sync(); } }, { signal: events.signal });
    priorityInput.addEventListener('input', () => {
        if (!active || !adapter) return;
        const value = Number(priorityInput.value);
        if (priorityInput.value === '') adapter.metadata({ priority:null });
        if (priorityInput.value !== '' && Number.isSafeInteger(value) && Math.abs(value) <= 1000000) adapter.metadata({ priority: value });
        sync();
    }, { signal: events.signal });
    async function load({ dataset, assignment }) {
        lastContext = { dataset, assignment };
        const current = ++generation;
        active = true; busy = true; adapter?.destroy(); adapter = null; host.replaceChildren(); host.hidden = false;
        cancelButton.hidden = false; saveButton.textContent = copy.save; restoreButton.textContent = copy.defaults;
        delete saveButton.dataset.langKey; delete restoreButton.dataset.langKey;
        notice(copy.loading); sync();
        if (!assignment.mutationAllowed) { busy = false; notice(''); sync(); return; }
        let targets = assignment.selectedGroupIDs.map(group_id => ({ scope: 'group', group_id }));
        try {
            let snapshot = validateArticleSnapshot(await readArticlePresentations(dataset, targets), { dataset, targets });
            if (assignment.targetScope === 'site' && !articleGroupsDiffer(snapshot)) {
                targets = [{ scope: 'site' }];
                snapshot = validateArticleSnapshot(await readArticlePresentations(dataset, targets), { dataset, targets });
            }
            if (current !== generation) return;
            const explanation = document.createElement('p');
            explanation.textContent = [snapshot.targets[0].scope !== 'site' ? copy.read_only : '',
                articleGroupsDiffer(snapshot) ? copy.mixed : '', articleOrdersDiffer(snapshot) ? copy.orders : ''].filter(Boolean).join(' ');
            const tableHost = document.createElement('div'); tableHost.className = 'article-presentations-table';
            tableHost.dataset.testid = 'article-presentations-table'; host.append(explanation, tableHost);
            notice('');
            adapter = createArticlePresentationsTable({ host: tableHost, snapshot, copy, onStatus: value => { if (current === generation) notice(value); },
                onDirtyChange: () => queueMicrotask(sync) });
            const links = snapshot.targets.map(target => target.assignments[0]);
            const name = links[0]?.name || '';
            nameInput.value = links.every(link => link?.name === name) ? name : '';
            nameInput.placeholder = copy.unchanged;
            nameInput.maxLength = snapshot.targets.length > 1 ? 100 : 128;
            priorityInput.value = links.every(link => (link?.priority || 0) === (links[0]?.priority || 0)) ? String(links[0]?.priority || 0) : '';
            priorityInput.placeholder = copy.unchanged;
            priorityRow.hidden = snapshot.targets[0].scope !== 'group';
            targetStatus.textContent = snapshot.targets[0].scope === 'site' ? targetCopy.targetSite : targetCopy.targetGroups;
            targetStatus.dataset.langKey = snapshot.targets[0].scope === 'site' ? 'view_field_assignments_target_site' : 'view_field_assignments_target_groups';
            const metadata = adapter.table.getChangeSet().metadata;
            if (Object.hasOwn(metadata, 'name')) nameInput.value = metadata.name;
            if (Object.hasOwn(metadata, 'priority')) priorityInput.value = String(metadata.priority);
        } catch { if (current === generation) notice(copy.failed); }
        finally { if (current === generation) { busy = false; sync(); } }
    }
    const languageObserver = new MutationObserver(() => {
        copy = getArticlePresentationsCopy();
        if (active && !busy && lastContext) void load(lastContext);
    });
    languageObserver.observe(document.documentElement, { attributes:true, attributeFilter:['lang'] });
    return { load, sync,
        async save() {
            if (!adapter || busy || adapter.isBlocked()) return;
            const current = generation, savingAdapter = adapter;
            busy = true; onBusy(true); sync();
            try { await savingAdapter.save(); } catch { /* Adapter reports the translated outcome and keeps the draft. */ }
            finally { if (current === generation) { busy = false; onBusy(false); sync(); } }
        },
        cancel() {
            adapter?.cancel();
            if (adapter) {
                const links = adapter.baseline().targets.map(target => target.assignments[0]);
                nameInput.value = links.every(link => link?.name === links[0]?.name) ? links[0]?.name || '' : '';
                priorityInput.value = links.every(link => link?.priority === links[0]?.priority) ? String(links[0]?.priority || 0) : '';
            }
            sync();
        },
        defaults() { adapter?.restoreDefaults(); sync(); },
        filter: term => adapter?.filter(term),
        hide() { generation++; active = false; adapter?.destroy(); adapter = null; host.hidden = true; cancelButton.hidden = true; nameInput.maxLength = 128; nameInput.placeholder = ''; },
        destroy() { generation++; active = false; adapter?.destroy(); events.abort(); languageObserver.disconnect(); },
    };
}
