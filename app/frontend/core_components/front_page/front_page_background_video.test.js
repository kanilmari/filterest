// front_page_background_video.test.js
// Exercises Home's background video fades with controllable media timing.
// Connects fake durations and positions to the two-copy cross-fade and its fallbacks.
// Prevents a hard loop cut, duplicate early downloads and motion for reduced-motion viewers.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BACKGROUND_VIDEO_FADE_SECONDS, BACKGROUND_VIDEO_VISIBLE, mountBackgroundVideo as mountVideo } from './front_page_background_video.js';
import { acquire, release } from '../../reusable_components/background_media_hold.js';

let layer;
let motion;
let cleanups;

function mountBackgroundVideo(...args) {
    const cleanup = mountVideo(...args);
    cleanups.push(cleanup);
    return cleanup;
}

/** jsdom has no media timeline; each copy gets a settable position and a fixed duration. */
function setTimeline(video, duration, currentTime) {
    let position = currentTime;
    Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => position, set: value => { position = value; } });
}

function tick(video, currentTime) {
    video.currentTime = currentTime;
    video.dispatchEvent(new Event('timeupdate'));
}

const visible = video => video.classList.contains(BACKGROUND_VIDEO_VISIBLE);

beforeEach(() => {
    vi.useFakeTimers();
    cleanups = [];
    document.body.innerHTML = '<div class="front-page-background"></div>';
    layer = document.querySelector('.front-page-background');
    motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    window.matchMedia = vi.fn(() => motion);
    const playing = new WeakSet();
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return !playing.has(this); });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { playing.delete(this); });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        playing.add(this);
        return Promise.resolve();
    });
});

afterEach(() => {
    cleanups.forEach(cleanup => cleanup());
    release('cifav');
    release('other');
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('the first hold pauses playback; only the last overlapping release resumes it', () => {
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const video = layer.querySelector('video');
    expect(video.paused).toBe(false);
    const pause = vi.spyOn(video, 'pause'), play = vi.spyOn(video, 'play');
    pause.mockClear(); play.mockClear();
    acquire('cifav');
    acquire('other');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
    expect(video.autoplay).toBe(false);
    release('cifav');
    expect(play).not.toHaveBeenCalled();
    release('other');
    release('other');
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(false);
});

test.each(['paused', 'reduced motion', 'unmounted'])('release never starts a video when %s', reason => {
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const video = layer.querySelector('video');
    if (reason === 'paused') video.pause();
    const play = vi.spyOn(video, 'play');
    play.mockClear();
    acquire('cifav');
    if (reason === 'reduced motion') motion.matches = true;
    if (reason === 'unmounted') layer.remove();
    release('cifav');
    expect(play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    expect(video.autoplay).toBe(false);
});

test('mounting during an existing hold stays still, and the release starts the video Home would have autoplayed', () => {
    acquire('cifav');
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const video = layer.querySelector('video');
    const syncMotion = motion.addEventListener.mock.calls[0][1];
    motion.matches = true; syncMotion();
    motion.matches = false; syncMotion();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    release('cifav');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(false);
});

test('mounting during a hold under reduced motion never starts the video on release', () => {
    motion.matches = true;
    acquire('cifav');
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const video = layer.querySelector('video');
    release('cifav');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(video.autoplay).toBe(false);
});

test('a hold cancels an in-progress fade and pauses both copies without restarting a fade', async () => {
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const first = layer.querySelector('video');
    setTimeline(first, 20, 0);
    tick(first, 12);
    const second = layer.querySelectorAll('video')[1];
    setTimeline(second, 20, 0);
    tick(first, 18);
    expect(vi.getTimerCount()).toBe(1);
    acquire('cifav');
    expect(vi.getTimerCount()).toBe(0);
    for (const video of [first, second]) expect(video.paused).toBe(true);
    HTMLMediaElement.prototype.play.mockClear();
    tick(second, 19);
    await vi.advanceTimersByTimeAsync(3000);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    release('cifav');
    expect(second.paused).toBe(false);
    expect(first.paused).toBe(true);
    expect(visible(second)).toBe(true);
});

test('cleanup unsubscribes even if the layer remains connected', () => {
    const cleanup = mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    acquire('cifav');
    cleanup();
    HTMLMediaElement.prototype.pause.mockClear();
    HTMLMediaElement.prototype.play.mockClear();
    release('cifav');
    acquire('other');
    release('other');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(layer.isConnected).toBe(true);
});

test('a late rejected fade cannot switch copies after a hold interrupts it', async () => {
    mountBackgroundVideo(layer, '/a.mp4', '50% 50%');
    const first = layer.querySelector('video');
    setTimeline(first, 20, 0);
    tick(first, 12);
    const second = layer.querySelectorAll('video')[1];
    setTimeline(second, 20, 0);
    let rejectFade;
    HTMLMediaElement.prototype.play.mockImplementationOnce(() => new Promise((_, reject) => { rejectFade = reject; }));
    tick(first, 18);
    acquire('cifav');
    release('cifav');
    rejectFade(new Error('interrupted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(visible(second)).toBe(true);
    expect(visible(first)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
});

test('the first copy fades in when its first frame arrives', () => {
    mountBackgroundVideo(layer, '/storage/site_media/front_page/original/a.mp4', '30% 60%');
    const [video] = layer.querySelectorAll('video');
    expect(visible(video)).toBe(false);
    expect(video.muted && video.loop && video.playsInline && video.autoplay).toBe(true);
    expect(video.style.objectPosition).toBe('30% 60%');
    video.dispatchEvent(new Event('loadeddata'));
    expect(visible(video)).toBe(true);
});

test('a second copy buffers shortly before the end and cross-fades back to the beginning', async () => {
    const cleanup = mountBackgroundVideo(layer, '/storage/site_media/front_page/original/a.mp4', '50% 50%');
    const [first] = layer.querySelectorAll('video');
    first.dispatchEvent(new Event('playing'));
    setTimeline(first, 20, 0);
    tick(first, 10);
    expect(layer.querySelectorAll('video')).toHaveLength(1);
    tick(first, 12);
    const second = layer.querySelectorAll('video')[1];
    expect(second?.preload).toBe('auto');
    expect(second.getAttribute('src')).toBe(first.getAttribute('src'));
    expect(visible(second)).toBe(false);
    setTimeline(second, 20, 4);
    HTMLMediaElement.prototype.play.mockClear();
    tick(first, 17.6);
    expect(second.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(visible(second)).toBe(true);
    expect(visible(first)).toBe(false);
    expect(layer.style.getPropertyValue('--front-page-video-fade')).toBe(`${BACKGROUND_VIDEO_FADE_SECONDS}s`);
    // The outgoing copy keeps no say during the fade, and stops at its start afterwards.
    tick(first, 19.9);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BACKGROUND_VIDEO_FADE_SECONDS * 1000);
    expect(first.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    // The next loop reuses the first copy instead of adding a third.
    tick(second, 18);
    expect(layer.querySelectorAll('video')).toHaveLength(2);
    expect(visible(first)).toBe(true);
    expect(visible(second)).toBe(false);
    cleanup();
    for (const video of layer.querySelectorAll('video')) expect(video.hasAttribute('src')).toBe(false);
});

test('a refused start keeps the playing copy in view', async () => {
    mountBackgroundVideo(layer, '/storage/site_media/front_page/original/a.webm', '50% 50%');
    const [first] = layer.querySelectorAll('video');
    first.dispatchEvent(new Event('playing'));
    setTimeline(first, 20, 0);
    tick(first, 12);
    const second = layer.querySelectorAll('video')[1];
    setTimeline(second, 20, 0);
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    tick(first, 18);
    await vi.advanceTimersByTimeAsync(0);
    expect(visible(first)).toBe(true);
    expect(visible(second)).toBe(false);
});

test('a video too short for a fade keeps its native loop', () => {
    mountBackgroundVideo(layer, '/storage/site_media/front_page/original/a.mp4', '50% 50%');
    const [first] = layer.querySelectorAll('video');
    setTimeline(first, 1.5, 0);
    tick(first, 1.4);
    expect(layer.querySelectorAll('video')).toHaveLength(1);
    expect(first.loop).toBe(true);
});

test('reduced motion shows a still frame and never cross-fades', () => {
    motion.matches = true;
    const cleanup = mountBackgroundVideo(layer, '/storage/site_media/front_page/original/a.mp4', '50% 50%');
    const [first] = layer.querySelectorAll('video');
    expect(first.autoplay).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    first.dispatchEvent(new Event('loadeddata'));
    expect(visible(first)).toBe(true);
    setTimeline(first, 20, 0);
    tick(first, 19);
    expect(layer.querySelectorAll('video')).toHaveLength(1);
    cleanup();
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', motion.addEventListener.mock.calls[0][1]);
});
