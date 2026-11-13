// Proves explicit administrator actions, correct pass accounting and safe termination.
// Exercises the new section on the actual media maintenance screen with mock responses.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { generate_fix_media_subfolders_view } from './fix_media_subfolders_view.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { LOCAL_TRANSLATION_FALLBACKS } from '../lang/local_translation_fallback_catalog.js';
import { IMAGE_DIMENSIONS_COPY } from './image_dimensions_copy.js';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
const call = vi.fn();
const counts = {
    galleries: 1, rows_seen: 0, would_write: 0, written: 0, already_sized: 0,
    skipped_no_file: 0, skipped_unresolved_reference: 0, skipped_non_object_metadata: 0,
    skipped_not_jsonb: 0, skipped_no_metadata_column: 0, skipped_unsupported_gallery: 0,
    originals_rotated_by_tag: 0, failed: 0,
};
const full = {...counts, rows_seen: 205, would_write: 200, written: 200, skipped_no_file: 5};
let panel, check, update, stop;
function fromKey(name) { return panel.querySelector('[data-lang-key^="image_dimensions_' + name + '"]'); }
function line(name) { return fromKey(name).parentElement.textContent; }
async function finished() { await vi.waitFor(() => expect(check.disabled).toBe(false)); }

beforeEach(async () => {
    document.body.replaceChildren();
    call.mockReset();
    endpoint_router.mockImplementation((route, options) => {
        if (route === 'datasetNames') return [];
        if (route === 'adminMissingMediaCheck') return {};
        if (route === 'adminImageDimensionsBackfill') return call(options);
        throw Error('Unexpected route ' + route);
    });
    await generate_fix_media_subfolders_view(document.body);
    panel = document.querySelector('[data-testid="image-dimensions"]');
    [check, update, stop] = panel.querySelectorAll('button');
});

describe('image dimensions in media maintenance', () => {
    test('loads idle and checks once even when the change cap is reached', async () => {
        expect(call).not.toHaveBeenCalled();
        call.mockResolvedValue({...full, written: 0, skipped_not_jsonb: 2});
        check.click();
        await finished();
        expect(call).toHaveBeenCalledExactlyOnceWith({
            method:'POST', body_data:{dry_run:true, max_rows:200}, suppressErrorToast:true,
        });
        expect(fromKey('checked')).toBeTruthy();
        expect(line('rows_seen')).toContain('205');
        expect(line('skipped_not_jsonb')).toContain('2');
        expect(fromKey('total')).toBeNull();
    });

    test('advances full updates, shows only last-pass counters and confirms cumulative writes', async () => {
        call.mockResolvedValueOnce(full).mockResolvedValueOnce({...counts, rows_seen:210, would_write:5, written:5, already_sized:200, skipped_no_file:5});
        update.click();
        await finished();
        expect(call).toHaveBeenCalledTimes(2);
        expect(call.mock.calls.every(([options]) => options.body_data.dry_run === false)).toBe(true);
        expect(fromKey('total').textContent).toContain('205');
        expect(line('rows_seen')).toContain('210');
        expect(line('skipped_no_file')).toContain('5');
        expect(fromKey('complete')).toBeTruthy();
    });

    test('finishes the active batch on Stop and a subsequent update can resume', async () => {
        let resolve;
        call.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        update.click();
        check.click();
        update.click();
        stop.click();
        expect(check.disabled && update.disabled && stop.disabled).toBe(true);
        resolve(full);
        await finished();
        expect(call).toHaveBeenCalledTimes(1);
        expect(fromKey('total').textContent).toContain('200');
        expect(fromKey('stopped')).toBeTruthy();
        call.mockResolvedValue({...counts, rows_seen:200, already_sized:200});
        update.click();
        await finished();
        expect(fromKey('total').dataset.langKey).toBe('image_dimensions_total+0');
        expect(fromKey('complete')).toBeTruthy();
    });

    test.each([
        ['empty object', {}, 'invalid'], ['missing response', null, 'invalid'],
        ['fraction', {...counts, rows_seen:1.5}, 'invalid'],
        ['impossible writes', {...counts, written:1}, 'invalid'],
        ['zero writes detected', {...full, written:0}, 'incomplete'],
        ['server reported failures', {...full, failed:2, written:198}, 'errors'],
        ['nothing to change', counts, 'complete'],
    ])('stops on %s', async (_reason, response, expected) => {
        call.mockResolvedValue(response);
        update.click();
        await finished();
        expect(call).toHaveBeenCalledTimes(1);
        expect(fromKey(expected)).toBeTruthy();
    });

    test('rechecks partially committed rows below the cap while the server makes progress', async () => {
        call.mockResolvedValueOnce({...counts, rows_seen:4, would_write:4, written:3})
            .mockResolvedValueOnce({...counts, rows_seen:4, would_write:1, written:1, already_sized:3});
        update.click();
        await finished();
        expect(call).toHaveBeenCalledTimes(2);
        expect(fromKey('total').textContent).toContain('4');
        expect(fromKey('complete')).toBeTruthy();
    });

    test('keeps known writes when a later request fails without retrying', async () => {
        call.mockResolvedValueOnce(full).mockRejectedValueOnce(Error('disconnected'));
        update.click();
        await finished();
        expect(call).toHaveBeenCalledTimes(2);
        expect(fromKey('request_error')).toBeTruthy();
        expect(fromKey('total').textContent).toContain('200');
    });

    test('does not continue once the tool has been closed', async () => {
        let resolve;
        call.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        update.click();
        panel.remove();
        resolve(full);
        await finished();
        expect(call).toHaveBeenCalledTimes(1);
    });

    test('registers Finnish, English, Chinese and Cantonese for every message', () => {
        for (const [key, copy] of Object.entries(IMAGE_DIMENSIONS_COPY)) {
            expect(LOCAL_TRANSLATION_FALLBACKS[key]).toEqual(copy);
            for (const language of ['fi', 'en', 'ch', 'yue']) expect(copy[language]?.trim()).toBeTruthy();
        }
    });
});
