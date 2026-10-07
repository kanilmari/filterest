// front_page_background_video.test.js
// Exercises Home's background video fades with controllable media timing.
// Connects fake durations and positions to the two-copy cross-fade and its fallbacks.
// Prevents a hard loop cut, duplicate early downloads and motion for reduced-motion viewers.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BACKGROUND_VIDEO_FADE_SECONDS, BACKGROUND_VIDEO_VISIBLE, mountBackgroundVideo } from './front_page_background_video.js';

let layer;
let motion;

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
    document.body.innerHTML = '<div class="front-page-background"></div>';
    layer = document.querySelector('.front-page-background');
    motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    window.matchMedia = vi.fn(() => motion);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
