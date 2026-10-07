// front_page_background_video.js
// Plays Home's background video with a soft start and a cross-fade back to its beginning.
// Connects Home's background layer with two muted copies of the same original file.
// Keeps reduced-motion viewers on a still frame and releases both copies on cleanup.

export const BACKGROUND_VIDEO_FADE_SECONDS = 2.5;
export const BACKGROUND_VIDEO_VISIBLE = 'front-page-background__video--visible';
// The second copy starts buffering this long before the first cross-fade, so one file is not fetched twice at once.
const STANDBY_LEAD_SECONDS = 6;
// Shorter fades look like a cut; a video too short for one keeps its native loop.
const MIN_FADE_SECONDS = 0.5;

function createCopy(src, objectPosition) {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    // The native loop stays as the fallback whenever a cross-fade cannot start.
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.style.objectPosition = objectPosition;
    return video;
}

function fadeSeconds(video) {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const fade = Math.min(BACKGROUND_VIDEO_FADE_SECONDS, duration / 4);
    return fade >= MIN_FADE_SECONDS ? fade : 0;
}

/** Adds the video to the layer and returns the cleanup that stops and releases every copy. */
export function mountBackgroundVideo(layer, src, objectPosition) {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const copies = [createCopy(src, objectPosition)];
    let active = copies[0];
    let standby = null;
    let fadeTimer = null;
    layer.append(active);

    // The first frame fades in from the page background; reduced motion shows it at once (CSS drops the transition).
    const reveal = () => copies[0].classList.add(BACKGROUND_VIDEO_VISIBLE);
    copies[0].addEventListener('loadeddata', reveal, { once: true });
    copies[0].addEventListener('playing', reveal, { once: true });

    function crossFade(fade) {
        const outgoing = active;
        const incoming = standby;
        layer.style.setProperty('--front-page-video-fade', `${fade}s`);
        incoming.currentTime = 0;
        const started = incoming.play();
        incoming.classList.add(BACKGROUND_VIDEO_VISIBLE);
        outgoing.classList.remove(BACKGROUND_VIDEO_VISIBLE);
        active = incoming;
        standby = outgoing;
        fadeTimer = setTimeout(() => {
            fadeTimer = null;
            outgoing.pause();
            outgoing.currentTime = 0;
        }, fade * 1000);
        // A refused start keeps the playing copy in view; its native loop carries on.
        void started?.catch?.(() => {
            clearTimeout(fadeTimer);
            fadeTimer = null;
            active = outgoing;
            standby = incoming;
            incoming.classList.remove(BACKGROUND_VIDEO_VISIBLE);
            outgoing.classList.add(BACKGROUND_VIDEO_VISIBLE);
        });
    }

    function onTimeUpdate(event) {
        if (event.target !== active || fadeTimer || motion?.matches) return;
        const fade = fadeSeconds(active);
        if (!fade) return;
        const remaining = active.duration - active.currentTime;
        if (!standby && remaining <= fade + STANDBY_LEAD_SECONDS) {
            standby = createCopy(src, objectPosition);
            standby.preload = 'auto';
            standby.addEventListener('timeupdate', onTimeUpdate);
            copies.push(standby);
            layer.append(standby);
        }
        if (standby && remaining <= fade) crossFade(fade);
    }
    active.addEventListener('timeupdate', onTimeUpdate);

    const syncMotion = () => {
        if (motion?.matches) {
            clearTimeout(fadeTimer);
            fadeTimer = null;
            for (const video of copies) {
                video.autoplay = false;
                video.pause();
                video.classList.toggle(BACKGROUND_VIDEO_VISIBLE, video === active && video.readyState >= 2);
            }
            return;
        }
        active.autoplay = true;
        if (active.isConnected) void active.play()?.catch(() => {});
    };
    syncMotion();
    motion?.addEventListener('change', syncMotion);

    return () => {
        clearTimeout(fadeTimer);
        motion?.removeEventListener('change', syncMotion);
        for (const video of copies) {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
    };
}
