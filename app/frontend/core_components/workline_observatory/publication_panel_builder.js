// publication_panel_builder.js
// Builds the existing release panel as Publications, with history and editable metadata.
// Connects administrator decisions to revision-protected release-goal API calls.
// Keeps locked scope intact while making the newest unpublished plan easy to find.

import { applyWorklineReleaseGoalAction, createWorklineReleaseGoal, saveWorklinePublication } from './workline_observatory_api_adapter.js';

export function buildPublicationPanel(state, copy, actions) {
    const panel = document.createElement('section');
    panel.className = 'workline-observatory__goal';
    const heading = document.createElement('h3'); heading.textContent = copy.goal;
    panel.append(heading);
    const publications = state.publications.length ? state.publications : state.releaseGoal ? [state.releaseGoal] : [];
    const details = document.createElement('div');
    const renderDetails = (goal) => {
        details.replaceChildren();
        if (goal.is_current_publication) {
            const current = document.createElement('p');
            current.className = 'workline-observatory__publication-current';
            current.dataset.publicationCurrent = 'true';
            current.textContent = copy.currentPublication;
            details.append(current);
        }
        const identity = document.createElement('strong'); identity.textContent = `${goal.identity_key} v${goal.version}`;
        const title = document.createElement('p'); title.textContent = `${goal.title} · ${goal.decision_state === 'locked' ? copy.locked : copy.draft}`;
        const outcome = document.createElement('p'); outcome.textContent = goal.outcome || '—';
        details.append(identity, title, outcome, buildPublicationEditor(goal, copy, actions));
        if (goal.decision_state === 'draft') {
            const lock = document.createElement('button');
            lock.type = 'button'; lock.className = 'button'; lock.textContent = copy.lockGoal;
            lock.addEventListener('click', () => actions.mutate(() => applyWorklineReleaseGoalAction(goal.id, 'lock')));
            details.append(lock);
        }
        setPublicationAvailability(panel, actions.busy);
    };
    if (publications.length) {
        const label = document.createElement('label');
        const text = document.createElement('span'); text.textContent = copy.publicationHistory;
        const select = document.createElement('select'); select.name = 'publication_id';
        publications.forEach((goal) => {
            const option = document.createElement('option'); option.value = String(goal.id);
            option.textContent = `${goal.is_current_publication ? `${copy.currentPublication} · ` : ''}${goal.title} · ${goal.publication_version || '—'} · ${goal.published ? copy.published : copy.unpublished}`;
            select.append(option);
        });
        select.addEventListener('change', () => renderDetails(publications.find((goal) => String(goal.id) === select.value)));
        label.append(text, select); panel.append(label, details);
        renderDetails(publications[0]);
    } else {
        const empty = document.createElement('p'); empty.textContent = copy.noGoal; panel.append(empty);
    }
    const creator = buildPublicationCreator(copy, actions);
    if (publications.length) {
        const disclosure = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = copy.newGoal;
        disclosure.append(summary, creator); panel.append(disclosure);
    } else panel.append(creator);
    setPublicationAvailability(panel, actions.busy);
    return panel;
}

function buildPublicationEditor(goal, copy, actions) {
    const form = document.createElement('form');
    form.className = 'workline-observatory__publication-editor';
    const fields = appendPublicationFields(form, goal, copy);
    const submit = document.createElement('button');
    submit.type = 'submit'; submit.className = 'button'; submit.textContent = copy.savePublication;
    form.append(submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await actions.mutate(() => saveWorklinePublication(goal.id, goal.publication_revision ?? 0, readPublicationFields(fields)), copy.publicationConflict);
    });
    return form;
}

function buildPublicationCreator(copy, actions) {
    const form = document.createElement('form'); form.className = 'workline-observatory__goal-creator';
    const heading = document.createElement('h4'); heading.textContent = copy.newGoal;
    form.append(heading);
    const identity = appendField(form, copy.goalKey, 'identity_key', 'text', 'release-', true);
    const revision = appendField(form, copy.goalRevision, 'version', 'number', '1', true); revision.min = '1';
    const title = appendField(form, copy.goalTitle, 'title', 'text', '', true); title.maxLength = 300;
    const outcome = appendField(form, copy.goalOutcome, 'outcome', 'textarea', '', true); outcome.maxLength = 2000;
    const fields = appendPublicationFields(form, {}, copy);
    fields.publication_version.required = true;
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button'; submit.textContent = copy.createGoal;
    form.append(submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await actions.mutate(() => createWorklineReleaseGoal({
            identity_key: identity.value, version: Number(revision.value), title: title.value, outcome: outcome.value,
            ...readPublicationFields(fields), selected: true,
        }), copy.publicationConflict);
    });
    return form;
}

function appendPublicationFields(form, goal, copy) {
    const fields = {
        publication_version: appendField(form, copy.publicationVersion, 'publication_version', 'text', goal.publication_version || ''),
        target_date: appendField(form, copy.targetDate, 'target_date', 'date', goal.target_date || ''),
        reader_description: appendField(form, copy.readerDescription, 'reader_description', 'textarea', goal.reader_description || ''),
        published: appendField(form, copy.published, 'published', 'checkbox', ''),
        published_at: appendField(form, copy.publishedAt, 'published_at', 'datetime-local', publicationLocalTime(goal.published_at)),
    };
    fields.publication_version.maxLength = 80;
    fields.reader_description.maxLength = 6000;
    fields.published.checked = Boolean(goal.published);
    fields.published_at.step = '0.001';
    fields.originalPublishedAt = goal.published_at || null;
    fields.originalLocalTime = fields.published_at.value;
    const synchronizeTime = () => { fields.published_at.disabled = !fields.published.checked; };
    fields.published.addEventListener('change', synchronizeTime);
    synchronizeTime();
    return fields;
}

function readPublicationFields(fields) {
    return {
        publication_version: fields.publication_version.value,
        target_date: fields.target_date.value || null,
        reader_description: fields.reader_description.value,
        published: fields.published.checked,
        published_at: !fields.published.checked || !fields.published_at.value ? null
            : fields.published_at.value === fields.originalLocalTime ? fields.originalPublishedAt
                : new Date(fields.published_at.value).toISOString(),
    };
}

// datetime-local uses the browser's zone; API instants always include their zone.
function publicationLocalTime(value) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function appendField(form, labelText, name, type, value, required = false) {
    const label = document.createElement('label');
    const text = document.createElement('span'); text.textContent = labelText;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.name = name; input.value = value; input.required = required;
    label.append(text, input); form.append(label);
    return input;
}

// Busy redraws preserve unsaved form values while retaining the time/flag dependency.
export function setPublicationAvailability(panel, busy) {
    panel.querySelectorAll('button,input,textarea,select').forEach((element) => { element.disabled = busy; });
    panel.querySelectorAll('form').forEach((form) => {
        const published = form.querySelector('[name="published"]');
        const time = form.querySelector('[name="published_at"]');
        if (time && published) time.disabled = busy || !published.checked;
    });
}
