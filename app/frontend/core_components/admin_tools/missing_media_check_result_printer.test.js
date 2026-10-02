// @vitest-environment jsdom
// missing_media_check_result_printer.test.js
// Verifies how the stored result of the missing media files check is rendered.
// Bridges result objects of every schema version and the rendered summary, notices and details.
// Exists so an administrator always learns who started the last run, on which versions, how far
// it reached and why it stopped, what the card picture pass found, and so an older stored
// result still renders.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderMissingMediaCheckResult } from './missing_media_check_result_printer.js';

function render(result, options = {}) {
    const area = document.createElement('div');
    document.body.appendChild(area);
    renderMissingMediaCheckResult(area, { has_result: true, last_result: result }, options);
    return area;
}

const keysIn = (area) => [...area.querySelectorAll('[data-lang-key]')].map((element) => element.dataset.langKey);

const secondShapeResult = {
    schema_version: 2,
    trigger: 'update',
    started_at: '2026-09-29T09:59:30Z',
    finished_at: '2026-09-29T10:00:00Z',
    app_version: '9.3.19',
    db_version: '9.9.2',
    build_id: 'build-a',
    sampling: 'random',
    sampling_seed: 12345,
    datasets_total: 4,
    datasets_checked: 2,
    rows_total: 250000,
    row_count_estimated: true,
    rows_checked: 9876,
    missing_count: 3,
    missing_rows: [
        { dataset: 'system_about', parent_row_id: 4, expected_path: '117/4/original/117_4_4.jpg', reason: 'no_file_in_any_variant' },
        { dataset: 'system_about', parent_row_id: 5, expected_path: '117/5/original/117_5_5.jpg', reason: 'no_file_in_any_variant' },
    ],
    missing_truncated: true,
    row_budget_reached: true,
    minimum_per_dataset_met: false,
    time_budget_reached: true,
    unused_files_requested: true,
    unused_files_count: 12,
    unused_files: ['117/9/original/stray.jpg'],
    unused_files_truncated: true,
    unused_files_walk_complete: false,
    datasets: [
        { dataset: 'photos', asset_table: 'photos_assets', row_count: 240000, row_count_estimated: true, planned_rows: 9000, checked_rows: 8876, missing_rows: 2, complete: false, unused_files_skipped: true },
        { dataset: 'system_about', asset_table: 'system_about_assets', row_count: 1000, planned_rows: 1000, checked_rows: 1000, missing_rows: 1, complete: true, unused_files: 12 },
    ],
    unreached_datasets: [
        { dataset: 'ghost', asset_table: 'ghost_assets', reason: 'lookup_failed', detail: 'sql: no rows in result set' },
        { dataset: 'late', asset_table: 'late_assets', reason: 'time_limit' },
    ],
    errors: ['unused files in 118: permission denied'],
};

const thirdShapeResult = {
    schema_version: 3,
    trigger: 'manual',
    finished_at: '2026-10-02T08:00:00Z',
    app_version: '9.3.20',
    db_version: '9.9.2',
    sampling: 'even',
    datasets_total: 2,
    datasets_checked: 2,
    rows_total: 40,
    rows_checked: 40,
    missing_count: 0,
    missing_rows: [],
    unused_files_requested: true,
    unused_files_count: 1,
    unused_files: ['117/7/original/stray.jpg'],
    unused_files_walk_complete: true,
    card_pictures_checked: 431,
    card_pass_complete: true,
    missing_card_pictures_count: 3,
    missing_card_pictures: [
        { dataset: 'about', row_id: 3, column: 'cached_image', stored_value: '117_3_3.jpg', expected_path: '117/3/original/117_3_3.jpg', owner_folder: '117/3', reason: 'card_picture_missing' },
        { dataset: 'brands', row_id: 8, column: 'logo_image', stored_value: 'no place in storage', reason: 'card_picture_unresolved' },
    ],
    kept_card_pictures_count: 1,
    kept_card_pictures: [
        { dataset: 'about', row_id: 2, column: 'cached_image', stored_value: '117_5_9.jpg', expected_path: '117/5/original/117_5_9.jpg', owner_folder: '117/5', reason: 'card_picture_kept_from_other_folder' },
    ],
    unchecked_card_pictures_count: 1,
    unchecked_card_pictures: [
        { dataset: 'brands', row_id: 1, column: 'logo_image', stored_value: '117_6_6.jpg', expected_path: '117/6/original/117_6_6.jpg', owner_folder: '117/6', reason: 'card_picture_unchecked' },
    ],
    card_lists_truncated: true,
    datasets: [
        { dataset: 'about', asset_table: 'about_assets', row_count: 40, planned_rows: 40, checked_rows: 40, missing_rows: 0, complete: true, unused_files: 1 },
    ],
    unreached_datasets: [],
    errors: [],
};

describe('missing_media_check_result_printer', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.documentElement.lang = 'en';
    });

    test('renders a first-shape result with what it has', () => {
        const area = render({
            schema_version: 1,
            trigger: 'startup',
            finished_at: '2026-09-23T06:00:00Z',
            datasets_total: 8,
            datasets_checked: 8,
            rows_total: 47,
            rows_checked: 47,
            missing_count: 0,
            missing_rows: [],
            unused_files_requested: true,
            unused_files_count: 0,
            datasets: [{ dataset: 'system_about', row_count: 3, planned_rows: 3, checked_rows: 3, complete: true }],
        });

        expect(area.textContent).toContain('the server start');
        expect(area.textContent).toContain('47 / 47');
        expect(area.textContent).toContain('Every checked file was found on disk.');
        expect(area.textContent).not.toContain('Application version');
        const keys = keysIn(area);
        // A first-shape result has no walk status, and its walk always finished.
        expect(keys).not.toContain('missing_media_check_unused_walk_incomplete');
        expect(keys).not.toContain('missing_media_check_run_failed');
        // Nor has it a card picture pass, which must not read as one that stopped early.
        expect(keys).not.toContain('missing_media_check_card_pictures_checked');
        expect(keys).not.toContain('missing_media_check_card_pass_incomplete');
    });

    test('names who started the run, when in local time, and on which versions', () => {
        const area = render(secondShapeResult);

        expect(keysIn(area)).toContain('missing_media_check_trigger_update');
        expect(area.textContent).toContain('an update');
        expect(area.textContent).toContain('9.3.19');
        expect(area.textContent).toContain('9.9.2');
        const lastRun = [...area.querySelectorAll('.missing-media-check__summary-line')]
            .find((line) => line.querySelector('[data-lang-key="missing_media_check_last_run"]'));
        expect(lastRun.title).toBe('2026-09-29T10:00:00Z');
        expect(lastRun.querySelector('strong').textContent).toContain('2026');
        expect(lastRun.querySelector('strong').textContent).not.toContain('T10:00:00Z');
        expect(area.textContent).toContain('9876 / ≈250000');
        expect(area.textContent).toContain('At random');
    });

    test('says each way the run fell short, with the listed counts', () => {
        const area = render(secondShapeResult);
        const keys = keysIn(area);

        expect(keys).toContain('missing_media_check_minimum_not_met');
        expect(keys).toContain('missing_media_check_time_budget_reached');
        expect(keys).toContain('missing_media_check_row_budget_reached');
        expect(keys).toContain('missing_media_check_row_count_estimated');
        expect(keys).toContain('missing_media_check_missing_list_truncated+2');
        expect(keys).toContain('missing_media_check_unused_list_truncated+1');
        expect(keys).toContain('missing_media_check_unused_walk_incomplete');
        expect(area.textContent).toContain('Only the first 2 missing files are listed.');
        expect(area.textContent).toContain('Only the first 1 files no recognised reference uses are listed.');
        expect(keys).not.toContain('missing_media_check_run_failed');
        expect(keys).not.toContain('missing_media_check_card_pass_incomplete');
    });

    test('puts errors, unreached datasets and the dataset table in a closed disclosure', () => {
        const area = render(secondShapeResult);
        const details = area.querySelector('[data-testid="missing-media-check-details"]');

        expect(details).not.toBeNull();
        expect(details.querySelector('.animated-disclosure-header').getAttribute('aria-expanded')).toBe('false');
        expect(details.querySelector('[data-testid="missing-media-check-errors"]').textContent)
            .toContain('permission denied');
        const unreached = details.querySelector('[data-testid="missing-media-check-unreached"]');
        expect(unreached.textContent).toContain('ghost');
        expect(unreached.textContent).toContain('its storage folder could not be found');
        expect(unreached.textContent).toContain('sql: no rows in result set');
        expect(unreached.textContent).toContain('the time limit ran out first');

        const table = details.querySelector('[data-testid="missing-media-check-datasets"]');
        expect(table.querySelector('thead [data-lang-key="missing_media_check_column_unused"]')).not.toBeNull();
        const rows = table.querySelectorAll('tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('photos');
        expect(rows[0].textContent).toContain('estimated');
        expect(rows[0].textContent).toContain('not looked for');
        expect(rows[0].querySelector('[data-lang-key="missing_media_check_no"]')).not.toBeNull();
        expect(rows[1].querySelector('[data-lang-key="missing_media_check_yes"]')).not.toBeNull();
        expect(rows[1].textContent).toContain('12');
        expect(details.querySelector('[data-testid="missing-media-check-unused-list"]').textContent)
            .toContain('117/9/original/stray.jpg');
        expect(details.textContent).toContain('12345');
    });

    test('keeps the details open across re-renders and reports the reader toggling them', async () => {
        const toggles = [];
        const area = render(secondShapeResult, { detailsOpen: true, onDetailsToggle: (open) => toggles.push(open) });
        const header = area.querySelector('[data-testid="missing-media-check-details"] .animated-disclosure-header');

        expect(header.getAttribute('aria-expanded')).toBe('true');
        header.click();
        await vi.waitFor(() => {
            expect(toggles).toEqual([false]);
        });
    });

    test('never claims every file was present for a run that failed before checking a row', () => {
        const area = render({
            schema_version: 2,
            trigger: 'update',
            finished_at: '2026-09-29T10:00:00Z',
            failed: true,
            rows_checked: 0,
            missing_rows: [],
            unused_files_requested: true,
            unused_files_walk_complete: false,
            errors: ['list file upload relations: connection refused'],
        });

        expect(keysIn(area)).toContain('missing_media_check_run_failed');
        expect(area.textContent).not.toContain('Every checked file was found on disk.');
        expect(area.textContent).toContain('connection refused');
        // The run stopped before the walk began, so no time limit cut the walk short.
        expect(keysIn(area)).not.toContain('missing_media_check_unused_walk_incomplete');
    });

    test('shows how many card pictures were checked and found missing', () => {
        const area = render(thirdShapeResult);
        const valueOf = (langKey) => [...area.querySelectorAll('.missing-media-check__summary-line')]
            .find((line) => line.querySelector(`[data-lang-key="${langKey}"]`))
            ?.querySelector('strong').textContent;

        expect(valueOf('missing_media_check_card_pictures_checked')).toBe('431');
        expect(valueOf('missing_media_check_missing_card_pictures')).toBe('3');
        expect(area.textContent).toContain('Card pictures checked');
        // A missing card picture means not every file was found, though no gallery file is missing.
        expect(area.textContent).not.toContain('Every checked file was found on disk.');
        expect(keysIn(area)).not.toContain('missing_media_check_card_pass_incomplete');
    });

    test('never claims every file was found while card pictures could not be checked, and says how many', () => {
        const area = render({
            ...thirdShapeResult,
            missing_card_pictures_count: 0,
            missing_card_pictures: [],
            unchecked_card_pictures_count: 2,
        });
        const uncheckedLine = [...area.querySelectorAll('.missing-media-check__summary-line')]
            .find((line) => line.querySelector('[data-lang-key="missing_media_check_unchecked_card_pictures"]'));

        expect(area.textContent).not.toContain('Every checked file was found on disk.');
        // The count stands in the summary, not only in the closed details.
        expect(uncheckedLine.textContent).toContain('Pictures that could not be checked');
        expect(uncheckedLine.querySelector('strong').textContent).toBe('2');
        expect(area.querySelector('[data-testid="missing-media-check-details"]').textContent)
            .toContain('A disk or permission error');
    });

    test('says every checked file was found only when nothing is missing and nothing is unchecked', () => {
        const clean = {
            ...thirdShapeResult,
            missing_card_pictures_count: 0,
            missing_card_pictures: [],
            unchecked_card_pictures_count: 0,
            unchecked_card_pictures: [],
        };
        const area = render(clean);
        expect(area.textContent).toContain('Every checked file was found on disk.');
        expect(keysIn(area)).not.toContain('missing_media_check_unchecked_card_pictures');

        // A listed unchecked picture counts even when its count field is missing.
        const listedOnly = render({ ...clean, unchecked_card_pictures: thirdShapeResult.unchecked_card_pictures });
        expect(listedOnly.textContent).not.toContain('Every checked file was found on disk.');

        // Missing files counted beyond an empty list are still missing.
        const unlisted = render({ ...clean, missing_count: 2 });
        expect(unlisted.textContent).not.toContain('Every checked file was found on disk.');
    });

    test('never claims every file was found while gallery files could not be checked, and says how many', () => {
        const area = render({
            ...thirdShapeResult,
            missing_card_pictures_count: 0,
            missing_card_pictures: [],
            unchecked_card_pictures_count: 0,
            unchecked_card_pictures: [],
            unchecked_files_count: 3,
        });
        const uncheckedLine = [...area.querySelectorAll('.missing-media-check__summary-line')]
            .find((line) => line.querySelector('[data-lang-key="missing_media_check_unchecked_files"]'));

        expect(area.textContent).not.toContain('Every checked file was found on disk.');
        expect(uncheckedLine.textContent).toContain('Files that could not be checked');
        expect(uncheckedLine.querySelector('strong').textContent).toBe('3');
    });

    test('lists missing, kept and unchecked card pictures in the details, each with its count', () => {
        const area = render(thirdShapeResult);
        const details = area.querySelector('[data-testid="missing-media-check-details"]');

        const missing = details.querySelector('[data-testid="missing-media-check-missing-card-pictures"]');
        expect(missing.children).toHaveLength(2);
        expect(missing.textContent).toContain('about #3');
        expect(missing.textContent).toContain('cached_image');
        expect(missing.textContent).toContain('117/3/original/117_3_3.jpg');
        // A value that names no place in storage shows itself and says so.
        expect(missing.children[1].textContent).toContain('no place in storage');
        expect(missing.children[1].querySelector('[data-lang-key="missing_media_check_unresolved_reference"]'))
            .not.toBeNull();

        const kept = details.querySelector('[data-testid="missing-media-check-kept-card-pictures"]');
        expect(kept.textContent).toContain('about #2');
        expect(kept.textContent).toContain('117/5/original/117_5_9.jpg');
        expect(details.textContent).toContain('until an administrator clears the card picture field');

        const unchecked = details.querySelector('[data-testid="missing-media-check-unchecked-card-pictures"]');
        expect(unchecked.textContent).toContain('brands #1');
        expect(details.textContent).toContain('A disk or permission error');

        const headings = [...details.querySelectorAll('.missing-media-check__details-heading')]
            .map((heading) => heading.textContent);
        expect(headings).toContain('Missing card pictures (3)');
        expect(headings).toContain("Card pictures kept from another row's folder (1)");
        expect(headings).toContain('Pictures that could not be checked (1)');
        // Only the list that was cut says so, with how many it lists.
        expect(keysIn(details).filter((key) => key.startsWith('missing_media_check_card_list_truncated')))
            .toEqual(['missing_media_check_card_list_truncated+2']);
    });

    test('says the card picture pass stopped early, except where the whole run failed', () => {
        const stopped = render({ ...thirdShapeResult, card_pass_complete: false });
        expect(keysIn(stopped)).toContain('missing_media_check_card_pass_incomplete');
        expect(stopped.textContent).toContain('some card pictures were not checked');

        const failed = render({ ...thirdShapeResult, card_pass_complete: false, failed: true });
        expect(keysIn(failed)).toContain('missing_media_check_run_failed');
        expect(keysIn(failed)).not.toContain('missing_media_check_card_pass_incomplete');
    });

    test('says why files no recognised reference uses were not looked for', () => {
        const withheld = {
            ...thirdShapeResult,
            card_pass_complete: false,
            unused_files_withheld: 'card_pass_incomplete',
            unused_files_count: 0,
            unused_files: [],
            unused_files_walk_complete: false,
            datasets: [{ ...thirdShapeResult.datasets[0], unused_files: 0, unused_files_skipped: true }],
        };
        const area = render(withheld);
        const keys = keysIn(area);

        expect(keys).toContain('missing_media_check_unused_withheld_card_pass_incomplete');
        expect(area.textContent).toContain('because not every picture field was read');
        // The walk never started, so no time limit cut it short, and no count of zero is claimed.
        expect(keys).not.toContain('missing_media_check_unused_walk_incomplete');
        const unusedLine = [...area.querySelectorAll('.missing-media-check__summary-line')]
            .find((line) => line.querySelector('[data-lang-key="missing_media_check_unused_files"]'));
        expect(unusedLine.querySelector('strong').textContent).toBe('not looked for');

        const unfinishedDatasets = render({ ...withheld, unused_files_withheld: 'datasets_incomplete' });
        expect(keysIn(unfinishedDatasets)).toContain('missing_media_check_unused_withheld_datasets_incomplete');
        expect(unfinishedDatasets.textContent).toContain('because not every dataset was checked completely');
    });

    test('lists files no recognised reference uses with the reminder to verify them', () => {
        const area = render(thirdShapeResult);
        const details = area.querySelector('[data-testid="missing-media-check-details"]');

        expect(area.textContent).toContain('Files no recognised reference uses');
        expect(details.querySelector('[data-testid="missing-media-check-unused-list"]').textContent)
            .toContain('117/7/original/stray.jpg');
        expect(details.textContent).toContain('A picture linked only from free text');
        expect(details.textContent).toContain('The check itself never deletes anything.');
    });

    test('says so when there is no result yet', () => {
        const area = document.createElement('div');
        renderMissingMediaCheckResult(area, { has_result: false, last_result: null });
        expect(area.textContent).toBe('The check has not run yet.');
    });
});
