// Image dimension controls for the existing administrator media maintenance view.
// Uses the registered backend route and counts each confirmed write once per run.
// Scan and skip counts describe a single pass because the server revisits rows.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getBackendRoutePathByHandler } from '../endpoints/backend_route_manifest_reader.js';
import { registerEndpointRoute } from '../pipeline/api_pipeline.js';
import { IMAGE_DIMENSIONS_COPY } from './image_dimensions_copy.js';

const route = 'adminImageDimensionsBackfill';
registerEndpointRoute(route, getBackendRoutePathByHandler('missing_media_check.AdminImageDimensionsBackfillHandler'));
const batchSize = 200;
const fields = [
    'galleries', 'rows_seen', 'already_sized', 'would_write', 'written',
    'skipped_no_file', 'skipped_unresolved_reference', 'skipped_non_object_metadata',
    'skipped_not_jsonb', 'skipped_no_metadata_column', 'skipped_unsupported_gallery',
    'originals_rotated_by_tag', 'failed',
];
let runningInTab = false;

function text(tag, name, value = null) {
    const key = 'image_dimensions_' + name;
    const element = document.createElement(tag);
    element.dataset.langKey = value === null ? key : key + '+' + value;
    element.textContent = IMAGE_DIMENSIONS_COPY[key].en.replace('$count', String(value));
    return element;
}

function validCounts(counts, dryRun) {
    return fields.every(key => Number.isSafeInteger(counts?.[key]) && counts[key] >= 0)
        && counts.would_write <= Math.min(counts.rows_seen, batchSize)
        && counts.written <= counts.would_write
        && (!dryRun || counts.written === 0);
}

function showPass(report, counts, pass, written, dryRun) {
    const fragment = document.createDocumentFragment();
    if (!dryRun) fragment.append(text('p', 'total', written));
    fragment.append(text('h4', 'pass', pass));
    for (const field of fields) {
        const line = document.createElement('div');
        line.className = 'missing-media-check__summary-line';
        line.append(text('span', field), String(counts[field]));
        fragment.append(line);
    }
    report.replaceChildren(fragment);
}

/** Adds an idle panel. Only an explicit administrator action sends the POST. */
export function appendImageDimensionsPanel(parent) {
    const section = document.createElement('section');
    section.className = 'missing-media-check';
    section.dataset.testid = 'image-dimensions';
    const description = text('p', 'description');
    description.className = 'missing-media-check__description';
    section.append(text('h3', 'title'), description);
    const actions = document.createElement('div');
    actions.className = 'missing-media-check__actions';
    const check = text('button', 'check');
    const update = text('button', 'update');
    const stop = text('button', 'stop');
    for (const button of [check, update, stop]) {
        button.type = 'button';
        button.className = 'button';
        actions.append(button);
    }
    stop.hidden = true;
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    const report = document.createElement('div');
    section.append(actions, status, report);
    parent.append(section);
    let stopping = false;

    function message(name) { status.replaceChildren(text('p', name)); }
    stop.addEventListener('click', () => {
        stopping = true;
        stop.disabled = true;
        message('stopping');
    });

    async function run(dryRun) {
        if (runningInTab) {
            message('busy');
            return;
        }
        runningInTab = true;
        check.disabled = update.disabled = true;
        stopping = false;
        stop.disabled = false;
        report.replaceChildren();

        async function passes() {
            stop.hidden = dryRun;
            message(dryRun ? 'checking' : 'updating');
            let written = 0;
            for (let pass = 1; section.isConnected; pass++) {
                const counts = await endpoint_router(route, {
                    method: 'POST', body_data: {dry_run: dryRun, max_rows: batchSize},
                    suppressErrorToast: true,
                });
                if (!validCounts(counts, dryRun)) { message('invalid'); return; }
                written += counts.written;
                showPass(report, counts, pass, written, dryRun);
                if (counts.failed) { message('errors'); return; }
                if (dryRun) { message('checked'); return; }
                if (stopping) { message('stopped'); return; }
                if (counts.would_write > 0 && counts.written === 0) { message('incomplete'); return; }
                // A concurrent filename change can protect rows from this write.
                // Recheck them if this pass made progress, even below the cap.
                if (counts.would_write < batchSize && counts.written === counts.would_write) {
                    message('complete');
                    return;
                }
            }
        }

        try {
            // A second tab on the same site must not launch its own series of POSTs.
            if (navigator.locks) {
                await navigator.locks.request(route, {ifAvailable: true}, lock => lock ? passes() : message('busy'));
            } else {
                await passes();
            }
        } catch {
            message('request_error');
        } finally {
            runningInTab = false;
            check.disabled = update.disabled = false;
            stop.hidden = true;
        }
    }
    check.addEventListener('click', () => run(true));
    update.addEventListener('click', () => run(false));
}
