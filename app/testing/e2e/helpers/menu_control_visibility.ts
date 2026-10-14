// menu_control_visibility.ts
// Samples rendered menu ownership through CSS animations and DOM handoffs.
// Connects G11 browser frames with geometry, accessibility and focusability checks.
// Retains transient failures that settled locator checks cannot see.

export type MenuProbeWindow = Window & { __homeMenuVisibilityProbe?: {
  frames: number; idleFrames: number; samples: number; failures: string[];
  sample: () => void; settled: () => boolean; stop: () => void;
} };

/** Installs a self-contained browser probe; its caller must stop it in finally. */
export function installMenuVisibilityProbe() {
  const probe = { frames: 0, idleFrames: 0, samples: 0, failures: [] as string[],
    sample: () => {}, settled: () => false, stop: () => {} };
  let frame = 0;
  const readControls = () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(
      '#showMenuButton, #hideMenuButton, [data-navbar-menu-button="true"]')];
    const controls = buttons.map(button => {
      const box = button.getBoundingClientRect();
      let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
      let top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
      let opaque = true;
      const announced = button.getAttribute('aria-hidden') === 'false'
        && !button.closest('[hidden], [inert], .hidden, [aria-hidden="true"]');
      const animations: { host: string; property: string }[] = [];
      for (let host: HTMLElement | null = button; host; host = host.parentElement) {
        const css = getComputedStyle(host);
        if (Number.parseFloat(css.opacity) === 0 || css.display === 'none') opaque = false;
        // Only the announced owner's own running animation or an ancestor's
        // can explain an empty frame. Paused/finished/unrelated motion cannot.
        if (announced) for (const animation of host.getAnimations()) {
          if (animation.playState === 'running') animations.push({
            host: host.id || host.className || host.tagName,
            property: 'transitionProperty' in animation ? String(animation.transitionProperty)
              : 'animationName' in animation ? String(animation.animationName) : 'animation',
          });
        }
        if (host === button) continue;
        const bounds = host.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX) || (css.clipPath && css.clipPath !== 'none')) {
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY) || (css.clipPath && css.clipPath !== 'none')) {
          top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
        }
      }
      const painted = opaque && right > left && bottom > top && getComputedStyle(button).visibility === 'visible';
      const hit = painted ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null;
      const pointerAccessible = Boolean(hit && button.contains(hit));
      // Pointer-disabled/inert controls still paint. A hit on their containing
      // surface cannot excuse a visible duplicate; an unrelated overlay can.
      const onScreen = painted && Boolean(hit && (pointerAccessible || hit.contains(button)));
      return { id: button.id || button.dataset.testid || 'hero-menu', painted, onScreen, announced, pointerAccessible,
        focusable: !button.disabled && button.tabIndex === 0, ariaHidden: button.getAttribute('aria-hidden'),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        clippedBox: { left, right, top, bottom }, visibility: getComputedStyle(button).visibility, animations };
    });
    return controls;
  };
  const valid = (controls: ReturnType<typeof readControls>, settled: boolean) => {
    const painted = controls.filter(control => control.painted);
    const owners = controls.filter(control => control.announced && control.focusable);
    if (painted.length > 1 || owners.length > 1
        || painted.some(control => control.ariaHidden === 'true' || !control.announced || !control.focusable)) return false;
    const owner = owners[0];
    if (settled || !owner?.animations.length) {
      return painted.length === 1 && owners.length === 1 && painted[0] === owner
        && owner.onScreen && owner.pointerAccessible;
    }
    return painted.length === 0 || painted[0] === owner;
  };
  const sample = (settled = false) => {
    const controls = readControls();
    if (!valid(controls, settled)) {
      if (probe.failures.length < 8) probe.failures.push(JSON.stringify(controls));
    }
    probe.samples++;
  };
  probe.sample = () => sample();
  // Pure strict read for focus assertions: polling may wait for a legitimate
  // fade/slide, but must never focus the destination or erase frame failures.
  probe.settled = () => valid(readControls(), true);
  const observer = new MutationObserver(() => sample());
  observer.observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'tabindex'] });
  const tick = () => {
    const moving = [...document.querySelectorAll(
      '.dataset-shared-topbar, .dataset-shared-topbar__menu-slot, #navbar, #showMenuButton')]
      .some(host => host.getAnimations().some(animation => animation.playState === 'running'))
      || readControls().some(control => control.animations.length > 0);
    sample(!moving); probe.frames++;
    probe.idleFrames = moving ? 0 : probe.idleFrames + 1;
    frame = requestAnimationFrame(tick);
  };
  probe.stop = () => { observer.disconnect(); cancelAnimationFrame(frame); };
  (window as MenuProbeWindow).__homeMenuVisibilityProbe = probe;
  sample(); frame = requestAnimationFrame(tick);
}
