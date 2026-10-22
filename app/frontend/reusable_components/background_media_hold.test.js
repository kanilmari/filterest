// background_media_hold.test.js
// Proves overlapping hold reasons and subscriber lifetimes without a media implementation.
// Connects first/last transitions to idempotent ownership cleanup.
// Protects a mounted player from premature resumes and stale listeners.
import { afterEach, expect, test, vi } from 'vitest';
import { acquire, release, subscribe } from './background_media_hold.js';

afterEach(() => {
    release('article');
    release('other');
});

test('overlapping keys compose, duplicate acquisition and release are harmless', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    expect(listener.mock.calls).toEqual([[false]]);
    acquire('article');
    acquire('article');
    acquire('other');
    release('article');
    release('article');
    expect(listener.mock.calls).toEqual([[false], [true]]);
    release('other');
    release('other');
    expect(listener.mock.calls).toEqual([[false], [true], [false]]);
    unsubscribe();
});

test('late subscribers receive the held state and unsubscribe independently', () => {
    acquire('article');
    const first = vi.fn(), second = vi.fn();
    const stopFirst = subscribe(first), stopSecond = subscribe(second);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
    stopFirst(); stopFirst();
    release('article');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls).toEqual([[true], [false]]);
    stopSecond();
    acquire('other');
    expect(second).toHaveBeenCalledTimes(2);
});
