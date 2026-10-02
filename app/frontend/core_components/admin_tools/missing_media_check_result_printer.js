// missing_media_check_result_printer.js
// Renders the stored result of the missing media files check: summary, notices, missing files and details.
// Bridges the check's result (schema 1, 2 or 3) and the media maintenance screen's result area.
// Exists so an administrator reads what the last run found, how far it reached and why it
// stopped, in their own language and local time, without the check being run again.

import { createAnimatedDisclosureSection } from '../../reusable_components/animated_disclosure/animated_disclosure_builder.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { formatTimestampDisplayText } from '../table_views/timestamp_display_formatter.js';
import {
    englishMissingMediaCheckCopy,
    missingMediaCheckTextElement,
} from './missing_media_check_translation_fallbacks.js';

const TRIGGER_KEYS = Object.freeze({
    manual: 'missing_media_check_trigger_manual',
    startup: 'missing_media_check_trigger_startup',
    update: 'missing_media_check_trigger_update',
});

const UNREACHED_REASON_KEYS = Object.freeze({
    lookup_failed: 'missing_media_check_unreached_lookup_failed',
    count_failed: 'missing_media_check_unreached_count_failed',
    read_failed: 'missing_media_check_unreached_read_failed',
    time_limit: 'missing_media_check_unreached_time_limit',
    no_budget: 'missing_media_check_unreached_no_budget',
});

const SAMPLING_KEYS = Object.freeze({
    even: 'missing_media_check_sampling_even',
    random: 'missing_media_check_sampling_random',
});

// Why no file was called one that no recognised reference uses: any dataset's row can
// point into any folder, so the list needs every gallery and every picture field read.
const UNUSED_WITHHELD_KEYS = Object.freeze({
    datasets_incomplete: 'missing_media_check_unused_withheld_datasets_incomplete',
    card_pass_incomplete: 'missing_media_check_unused_withheld_card_pass_incomplete',
});

// The card picture lists of a schema 3 result, in the order the details show them. An
// explanation says what a list means where its heading alone cannot.
const CARD_PICTURE_LISTS = Object.freeze([
    {
        findings: 'missing_card_pictures',
        count: 'missing_card_pictures_count',
        headingKey: 'missing_media_check_missing_card_pictures',
        testId: 'missing-media-check-missing-card-pictures',
    },
    {
        findings: 'kept_card_pictures',
        count: 'kept_card_pictures_count',
        headingKey: 'missing_media_check_kept_card_pictures',
        explanationKey: 'missing_media_check_kept_card_pictures_explanation',
        testId: 'missing-media-check-kept-card-pictures',
    },
    {
        findings: 'unchecked_card_pictures',
        count: 'unchecked_card_pictures_count',
        headingKey: 'missing_media_check_unchecked_card_pictures',
        explanationKey: 'missing_media_check_unchecked_card_pictures_explanation',
        testId: 'missing-media-check-unchecked-card-pictures',
    },
]);

function wholeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function listOf(value) {
    return Array.isArray(value) ? value : [];
}

/** How many findings of one kind the run counted, never fewer than its list holds. */
function findingCount(result, findingsKey, countKey) {
    return Math.max(wholeNumber(result[countKey]), listOf(result[findingsKey]).length);
}

/** A result of schema 3 or later carries the card picture pass; an older one has none of its fields. */
function hasCardPass(result) {
    return typeof result.card_pass_complete === 'boolean';
}

/**
 * Every checked file was found only when no file is missing and no card picture is
 * missing or could not be checked: an unchecked picture was found neither present nor missing.
 */
function everyCheckedFileFound(result, missingRows) {
    return Math.max(wholeNumber(result.missing_count), missingRows.length) === 0
        && wholeNumber(result.unchecked_files_count) === 0
        && findingCount(result, 'missing_card_pictures', 'missing_card_pictures_count') === 0
        && findingCount(result, 'unchecked_card_pictures', 'unchecked_card_pictures_count') === 0;
}

/** A stored time in the reader's own time zone and language; the raw value stays in the title. */
function localTime(value) {
    if (!value) return '';
    const locale = document.documentElement.lang || getLanguageWithBrowserFallback();
    return formatTimestampDisplayText(value, '', { force: true, displayMode: 'date_time', locale }) || String(value);
}

function summaryLine(langKey, valueNode) {
    const line = document.createElement('p');
    line.className = 'missing-media-check__summary-line';
    line.appendChild(missingMediaCheckTextElement('span', langKey));
    const valueElement = document.createElement('strong');
    if (valueNode instanceof Node) {
        valueElement.appendChild(valueNode);
    } else {
        valueElement.textContent = String(valueNode ?? '');
    }
    line.appendChild(valueElement);
    return line;
}

function notice(resultArea, condition, langKey, variable = null) {
    if (!condition) return;
    const element = missingMediaCheckTextElement('p', langKey, variable);
    element.className = 'missing-media-check__notice';
    resultArea.appendChild(element);
}

function tag(langKey) {
    const element = missingMediaCheckTextElement('span', langKey);
    element.className = 'missing-media-check__tag';
    return element;
}

function triggerNode(trigger) {
    const langKey = TRIGGER_KEYS[trigger];
    return langKey ? missingMediaCheckTextElement('span', langKey) : document.createTextNode(String(trigger || ''));
}

/** "checked / total", the total marked as approximate when a dataset was estimated. */
function checkedOfTotal(checked, total, estimated) {
    return `${wholeNumber(checked)} / ${estimated ? '≈' : ''}${wholeNumber(total)}`;
}

function appendSummary(resultArea, result) {
    const lastRun = summaryLine('missing_media_check_last_run', localTime(result.finished_at));
    lastRun.title = String(result.finished_at || '');
    resultArea.appendChild(lastRun);
    if (result.trigger) {
        resultArea.appendChild(summaryLine('missing_media_check_trigger', triggerNode(result.trigger)));
    }
    if (result.app_version) {
        resultArea.appendChild(summaryLine('missing_media_check_app_version', result.app_version));
    }
    if (result.db_version) {
        resultArea.appendChild(summaryLine('missing_media_check_db_version', result.db_version));
    }
    resultArea.appendChild(summaryLine(
        'missing_media_check_datasets_checked',
        `${wholeNumber(result.datasets_checked)} / ${wholeNumber(result.datasets_total)}`,
    ));
    resultArea.appendChild(summaryLine(
        'missing_media_check_rows_checked',
        checkedOfTotal(result.rows_checked, result.rows_total, result.row_count_estimated === true),
    ));
    resultArea.appendChild(summaryLine('missing_media_check_missing_files', String(wholeNumber(result.missing_count))));
    // A gallery file that could not be looked at is neither found nor missing either.
    const uncheckedFiles = wholeNumber(result.unchecked_files_count);
    if (uncheckedFiles > 0) {
        resultArea.appendChild(summaryLine('missing_media_check_unchecked_files', String(uncheckedFiles)));
    }
    if (hasCardPass(result)) {
        resultArea.appendChild(summaryLine(
            'missing_media_check_card_pictures_checked',
            String(wholeNumber(result.card_pictures_checked)),
        ));
        resultArea.appendChild(summaryLine(
            'missing_media_check_missing_card_pictures',
            String(wholeNumber(result.missing_card_pictures_count)),
        ));
        // A picture whose file could not be checked, for example because the storage
        // could not be read, is neither found nor missing, so its count is stated here
        // rather than only in the details.
        const uncheckedCardPictures = findingCount(result, 'unchecked_card_pictures', 'unchecked_card_pictures_count');
        if (uncheckedCardPictures > 0) {
            resultArea.appendChild(summaryLine(
                'missing_media_check_unchecked_card_pictures',
                String(uncheckedCardPictures),
            ));
        }
    }
    if (result.unused_files_requested) {
        // A withheld list was never looked for, so a count of zero would claim too much.
        resultArea.appendChild(summaryLine('missing_media_check_unused_files', result.unused_files_withheld
            ? missingMediaCheckTextElement('span', 'missing_media_check_unused_skipped')
            : String(wholeNumber(result.unused_files_count))));
    }
    if (SAMPLING_KEYS[result.sampling] && result.row_budget_reached) {
        resultArea.appendChild(summaryLine(
            'missing_media_check_sampling_setting',
            missingMediaCheckTextElement('span', SAMPLING_KEYS[result.sampling]),
        ));
    }
}

// Each notice says one way the run fell short. The broad "more datasets than the
// budget" notice replaces the narrower minimum and sample notices it implies.
function appendNotices(resultArea, result, missingRows, unusedFiles) {
    notice(resultArea, result.failed === true, 'missing_media_check_run_failed');
    notice(resultArea, result.datasets_exceed_budget, 'missing_media_check_datasets_exceed_budget');
    notice(resultArea, result.minimum_per_dataset_met === false && !result.datasets_exceed_budget,
        'missing_media_check_minimum_not_met');
    notice(resultArea, result.time_budget_reached, 'missing_media_check_time_budget_reached');
    notice(resultArea, result.row_budget_reached && !result.datasets_exceed_budget,
        'missing_media_check_row_budget_reached');
    notice(resultArea, result.row_count_estimated === true, 'missing_media_check_row_count_estimated');
    // An older result has no card picture pass; a failed run already says it stopped early.
    notice(resultArea, result.card_pass_complete === false && result.failed !== true,
        'missing_media_check_card_pass_incomplete');
    notice(resultArea, result.missing_truncated === true, 'missing_media_check_missing_list_truncated',
        missingRows.length);
    notice(resultArea, result.unused_files_requested && result.unused_files_truncated === true,
        'missing_media_check_unused_list_truncated', unusedFiles.length);
    // A version 1 result has no walk status, and its walk always finished. A withheld list
    // and a failed run never started the walk, so no time limit cut it short.
    notice(resultArea, result.unused_files_requested && result.unused_files_walk_complete === false
        && !result.unused_files_withheld && result.failed !== true,
        'missing_media_check_unused_walk_incomplete');
    const withheldKey = UNUSED_WITHHELD_KEYS[result.unused_files_withheld];
    notice(resultArea, Boolean(withheldKey), withheldKey);
}

function appendMissingList(resultArea, result, missingRows) {
    if (missingRows.length === 0) {
        // A run that failed before checking a row or a picture found nothing, present or missing.
        if (result.failed === true && wholeNumber(result.rows_checked) === 0
            && wholeNumber(result.card_pictures_checked) === 0) return;
        // A file counted missing, or a card picture missing or left unchecked, is counted
        // above and listed in the details; then not every file was found.
        if (!everyCheckedFileFound(result, missingRows)) return;
        const allPresent = missingMediaCheckTextElement('p', 'missing_media_check_all_present');
        allPresent.className = 'missing-media-check__ok';
        resultArea.appendChild(allPresent);
        return;
    }
    const list = document.createElement('ul');
    list.className = 'missing-media-check__missing-list';
    list.dataset.testid = 'missing-media-check-missing-list';
    for (const row of missingRows) {
        const item = document.createElement('li');
        const identity = document.createElement('span');
        identity.className = 'missing-media-check__missing-identity';
        identity.textContent = `${row.dataset} #${row.parent_row_id}`;
        const path = document.createElement('code');
        path.textContent = row.expected_path || row.stored_value || '';
        item.appendChild(identity);
        item.appendChild(path);
        if (row.reason === 'unresolved_reference') {
            item.appendChild(tag('missing_media_check_unresolved_reference'));
        } else if (row.legacy_flat_filename) {
            item.appendChild(tag('missing_media_check_legacy_filename'));
        }
        list.appendChild(item);
    }
    resultArea.appendChild(list);
}

function detailsHeading(langKey) {
    const heading = missingMediaCheckTextElement('h4', langKey);
    heading.className = 'missing-media-check__details-heading';
    return heading;
}

/** A details heading followed by how many the run found, which can be more than it listed. */
function countedDetailsHeading(langKey, count) {
    const heading = document.createElement('h4');
    heading.className = 'missing-media-check__details-heading';
    // The translator replaces only the keyed span, so the count stays beside it.
    heading.append(missingMediaCheckTextElement('span', langKey), ` (${wholeNumber(count)})`);
    return heading;
}

function mutedParagraph(langKey) {
    const paragraph = missingMediaCheckTextElement('p', langKey);
    paragraph.className = 'missing-media-check__muted';
    return paragraph;
}

function appendErrors(content, errors) {
    if (errors.length === 0) return;
    content.appendChild(detailsHeading('missing_media_check_errors'));
    const list = document.createElement('ul');
    list.className = 'missing-media-check__error-list';
    list.dataset.testid = 'missing-media-check-errors';
    for (const error of errors) {
        const item = document.createElement('li');
        const text = document.createElement('code');
        text.textContent = String(error);
        item.appendChild(text);
        list.appendChild(item);
    }
    content.appendChild(list);
}

function appendUnreached(content, unreached) {
    if (unreached.length === 0) return;
    content.appendChild(detailsHeading('missing_media_check_unreached_datasets'));
    const list = document.createElement('ul');
    list.className = 'missing-media-check__unreached-list';
    list.dataset.testid = 'missing-media-check-unreached';
    for (const dataset of unreached) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'missing-media-check__missing-identity';
        name.textContent = String(dataset.dataset || dataset.asset_table || '');
        item.appendChild(name);
        const reasonKey = UNREACHED_REASON_KEYS[dataset.reason];
        item.appendChild(reasonKey ? missingMediaCheckTextElement('span', reasonKey)
            : document.createTextNode(String(dataset.reason || '')));
        if (dataset.detail) {
            const detail = document.createElement('code');
            detail.textContent = String(dataset.detail);
            item.appendChild(detail);
        }
        list.appendChild(item);
    }
    content.appendChild(list);
}

function tableCell(tagName, content) {
    const cell = document.createElement(tagName);
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = String(content ?? '');
    return cell;
}

function rowCountCell(dataset) {
    const wrapper = document.createElement('span');
    wrapper.textContent = String(wholeNumber(dataset.row_count));
    if (dataset.row_count_estimated === true) {
        wrapper.appendChild(document.createTextNode(' '));
        wrapper.appendChild(tag('missing_media_check_estimated'));
    }
    return wrapper;
}

function unusedCell(dataset) {
    if (dataset.unused_files_skipped === true) {
        return missingMediaCheckTextElement('span', 'missing_media_check_unused_skipped');
    }
    return String(wholeNumber(dataset.unused_files));
}

function appendDatasetTable(content, datasets, unusedRequested) {
    if (datasets.length === 0) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'missing-media-check__table-wrapper';
    const table = document.createElement('table');
    table.className = 'missing-media-check__dataset-table';
    table.dataset.testid = 'missing-media-check-datasets';
    const headerKeys = [
        'missing_media_check_column_dataset',
        'missing_media_check_column_rows',
        'missing_media_check_column_planned',
        'missing_media_check_column_checked',
        'missing_media_check_column_missing',
        'missing_media_check_column_complete',
    ];
    if (unusedRequested) headerKeys.push('missing_media_check_column_unused');
    const headerRow = document.createElement('tr');
    for (const langKey of headerKeys) {
        const header = tableCell('th', missingMediaCheckTextElement('span', langKey));
        header.scope = 'col';
        headerRow.appendChild(header);
    }
    const head = document.createElement('thead');
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    for (const dataset of datasets) {
        const row = document.createElement('tr');
        const name = tableCell('th', String(dataset.dataset || dataset.asset_table || ''));
        name.scope = 'row';
        row.appendChild(name);
        row.appendChild(tableCell('td', rowCountCell(dataset)));
        row.appendChild(tableCell('td', String(wholeNumber(dataset.planned_rows))));
        row.appendChild(tableCell('td', String(wholeNumber(dataset.checked_rows))));
        row.appendChild(tableCell('td', String(wholeNumber(dataset.missing_rows))));
        row.appendChild(tableCell('td', missingMediaCheckTextElement('span',
            dataset.complete === true ? 'missing_media_check_yes' : 'missing_media_check_no')));
        if (unusedRequested) row.appendChild(tableCell('td', unusedCell(dataset)));
        body.appendChild(row);
    }
    table.append(head, body);
    wrapper.appendChild(table);
    content.appendChild(wrapper);
}

function cardPictureItem(finding) {
    const item = document.createElement('li');
    const identity = document.createElement('span');
    identity.className = 'missing-media-check__missing-identity';
    identity.textContent = `${finding.dataset} #${finding.row_id}`;
    const column = document.createElement('span');
    column.textContent = String(finding.column || '');
    const path = document.createElement('code');
    path.textContent = finding.expected_path || finding.stored_value || '';
    item.append(identity, column, path);
    if (finding.reason === 'card_picture_unresolved') {
        item.appendChild(tag('missing_media_check_unresolved_reference'));
    }
    return item;
}

function appendCardPictureLists(content, result) {
    for (const definition of CARD_PICTURE_LISTS) {
        const findings = listOf(result[definition.findings]);
        const count = findingCount(result, definition.findings, definition.count);
        if (count === 0) continue;
        content.appendChild(countedDetailsHeading(definition.headingKey, count));
        if (definition.explanationKey) content.appendChild(mutedParagraph(definition.explanationKey));
        // One flag covers all three lists; a list that was cut lists fewer than it counts.
        notice(content, result.card_lists_truncated === true && findings.length < count,
            'missing_media_check_card_list_truncated', findings.length);
        if (findings.length === 0) continue;
        const list = document.createElement('ul');
        list.className = 'missing-media-check__missing-list';
        list.dataset.testid = definition.testId;
        for (const finding of findings) list.appendChild(cardPictureItem(finding));
        content.appendChild(list);
    }
}

function appendUnusedFiles(content, unusedFiles) {
    if (unusedFiles.length === 0) return;
    content.appendChild(detailsHeading('missing_media_check_unused_files'));
    // A picture linked only from free text is no recognised reference: the list is to verify.
    content.appendChild(mutedParagraph('missing_media_check_unused_files_note'));
    const list = document.createElement('ul');
    list.className = 'missing-media-check__missing-list';
    list.dataset.testid = 'missing-media-check-unused-list';
    for (const file of unusedFiles) {
        const item = document.createElement('li');
        const path = document.createElement('code');
        path.textContent = String(file);
        item.appendChild(path);
        list.appendChild(item);
    }
    content.appendChild(list);
}

function buildDetails(result, missingRows, unusedFiles, options) {
    const content = document.createElement('div');
    content.className = 'missing-media-check__details-content';
    appendErrors(content, listOf(result.errors));
    appendUnreached(content, listOf(result.unreached_datasets));
    appendDatasetTable(content, listOf(result.datasets), result.unused_files_requested === true);
    appendCardPictureLists(content, result);
    appendUnusedFiles(content, unusedFiles);
    if (result.sampling === 'random' && result.sampling_seed) {
        content.appendChild(summaryLine('missing_media_check_sampling_seed', String(result.sampling_seed)));
    }
    if (content.childElementCount === 0) return null;

    const details = createAnimatedDisclosureSection({
        titleLangKey: 'missing_media_check_details',
        titleText: englishMissingMediaCheckCopy('missing_media_check_details'),
        contentElement: content,
        startOpen: options.detailsOpen === true,
        sectionClassNames: 'missing-media-check__details',
    });
    details.dataset.testid = 'missing-media-check-details';
    details.addEventListener('animated-disclosure-toggle', (event) => {
        if (event?.detail?.section === details && typeof options.onDetailsToggle === 'function') {
            options.onDetailsToggle(event.detail.expanded === true);
        }
    });
    return details;
}

/**
 * Renders the stored state of the check into the result area, replacing what was there.
 * A version 1 or 2 result, which lacks the newer fields, renders with what it has.
 *
 * @param {HTMLElement} resultArea
 * @param {object} state - The check endpoint's answer.
 * @param {{detailsOpen?: boolean, onDetailsToggle?: (open: boolean) => void}} [options]
 */
export function renderMissingMediaCheckResult(resultArea, state, options = {}) {
    resultArea.replaceChildren();
    const result = state && state.last_result;
    if (!state || !state.has_result || !result) {
        const never = missingMediaCheckTextElement('p', 'missing_media_check_never_run');
        never.className = 'missing-media-check__muted';
        resultArea.appendChild(never);
        return;
    }
    const missingRows = listOf(result.missing_rows);
    const unusedFiles = listOf(result.unused_files);
    appendSummary(resultArea, result);
    appendNotices(resultArea, result, missingRows, unusedFiles);
    appendMissingList(resultArea, result, missingRows);
    const details = buildDetails(result, missingRows, unusedFiles, options);
    if (details) resultArea.appendChild(details);
}
