// @vitest-environment jsdom
// menu_control_visibility.test.ts
// Proves the browser sampler rejects transient duplicate or inaccessible menus.
// Uses representative geometry with the same sampler installed by native G11.
// Distinguishes painted controls from transparent, clipped and off-screen hosts.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installMenuVisibilityProbe, type MenuProbeWindow } from './menu_control_visibility';

let source: HTMLButtonElement;
let local: HTMLButtonElement;
let slot: HTMLElement;
let bar: HTMLElement;
let frames: FrameRequestCallback[];
const originalAnimations = HTMLElement.prototype.getAnimations;

function bounds(element: HTMLElement, x: number, width = 44) {
  element.getBoundingClientRect = () => new DOMRect(x, 12, width, 44);
}

function probe() { return (window as MenuProbeWindow).__homeMenuVisibilityProbe!; }

beforeEach(() => {
  document.body.innerHTML = `<button id="showMenuButton" aria-hidden="false" tabindex="0"></button>
    <div class="dataset-shared-topbar"><div class="dataset-shared-topbar__menu-slot">
      <button data-navbar-menu-button="true" aria-hidden="true" tabindex="-1" style="visibility:hidden"></button>
    </div></div>`;
  source = document.querySelector('#showMenuButton')!;
  local = document.querySelector('[data-navbar-menu-button]')!;
  slot = local.parentElement!; bar = slot.parentElement!;
  bounds(source, 12); bounds(local, 70); bounds(slot, 70, 52); bounds(bar, 0, 600);
  frames = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.push(callback); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  HTMLElement.prototype.getAnimations = vi.fn(() => []);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn((x, y) => {
    return [source, local].find(button => {
      const box = button.getBoundingClientRect();
      return getComputedStyle(button).pointerEvents !== 'none' && x >= box.left && x < box.right
        && y >= box.top && y < box.bottom;
    }) || document.body;
  }) });
});

afterEach(() => {
  probe()?.stop(); delete (window as MenuProbeWindow).__homeMenuVisibilityProbe;
  document.body.replaceChildren();
  document.body.removeAttribute('inert');
  document.body.style.opacity = '';
  delete (document.body as Partial<HTMLElement>).getAnimations;
  delete (document as Partial<Document>).elementFromPoint;
  if (originalAnimations) HTMLElement.prototype.getAnimations = originalAnimations;
  else delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  vi.unstubAllGlobals();
});

test('accepts one visible, focusable and announced control', () => {
  installMenuVisibilityProbe();
  expect(probe().failures).toEqual([]);
  expect(probe().settled()).toBe(true);
});

test('rejects round 3: painted aria-hidden topbar copy alongside the fallback', () => {
  local.style.visibility = 'visible'; bar.style.opacity = '0.5';
  bar.getAnimations = () => [{ playState: 'running' } as Animation];
  installMenuVisibilityProbe();
  expect(probe().failures).toHaveLength(1);
  expect(JSON.parse(probe().failures[0]).filter(control => control.painted)).toHaveLength(2);
});

test('rejects shape C: two announced, focusable owners even with the closer offscreen', () => {
  const close = document.createElement('button'); close.id = 'hideMenuButton';
  close.setAttribute('aria-hidden', 'false'); close.tabIndex = 0;
  document.body.append(close); bounds(close, -288);
  close.getAnimations = () => [{ playState: 'running' } as Animation];
  installMenuVisibilityProbe();
  expect(probe().failures).toHaveLength(1);
  expect(JSON.parse(probe().failures[0]).filter(control => control.announced && control.focusable)).toHaveLength(2);
});

test.each(['fade on owner', 'fade on ancestor', 'slide on ancestor'])(
  'allows an empty frame only during a running %s, then requires one settled owner', async kind => {
  if (kind === 'fade on owner') source.style.opacity = '0';
  else if (kind === 'fade on ancestor') document.body.style.opacity = '0';
  else bounds(source, -288);
  const animated = kind === 'fade on owner' ? source : document.body;
  animated.getAnimations = () => [{ playState: 'running' } as Animation];
  installMenuVisibilityProbe(); frames.shift()!(0);
  expect(probe().failures).toEqual([]); expect(probe().idleFrames).toBe(0);
  expect(probe().settled()).toBe(false);
  source.style.opacity = '1'; document.body.style.opacity = '1'; bounds(source, 12);
  animated.getAnimations = () => [];
  await Promise.resolve(); frames.shift()!(16); frames.shift()!(32);
  expect(probe().failures).toEqual([]); expect(probe().idleFrames).toBe(2);
  expect(probe().settled()).toBe(true);
});

test.each(['static', 'paused', 'finished', 'idle', 'unrelated running'])(
  'rejects an empty %s frame and the strict focus read', kind => {
  source.style.opacity = '0';
  if (kind === 'unrelated running') bar.getAnimations = () => [{ playState: 'running' } as Animation];
  else if (kind !== 'static') source.getAnimations = () => [{ playState: kind } as Animation];
  installMenuVisibilityProbe();
  expect(probe().failures).toHaveLength(1); expect(probe().settled()).toBe(false);
  frames.shift()!(0);
  expect(probe().failures).toHaveLength(2);
});

test('rejects a fade that finishes without ever painting its owner in idle frames', () => {
  source.style.opacity = '0';
  source.getAnimations = () => [{ playState: 'running' } as Animation];
  installMenuVisibilityProbe();
  expect(probe().failures).toEqual([]);
  source.getAnimations = () => [];
  frames.shift()!(0);
  expect(probe().idleFrames).toBe(1); expect(probe().failures).toHaveLength(1);
});

test.each(['duplicate', 'duplicate pointer blocked', 'aria-hidden fade', 'aria-hidden inert fade'])(
  'rejects a painted %s even if pointer input cannot reach it', kind => {
  local.style.visibility = 'visible';
  if (kind.startsWith('duplicate')) { local.setAttribute('aria-hidden', 'false'); local.tabIndex = 0; }
  else { bar.style.opacity = '0.5'; slot.style.opacity = '0.5'; }
  if (kind.includes('inert')) { slot.inert = true; local.style.pointerEvents = 'none'; }
  if (kind.includes('pointer blocked')) local.style.pointerEvents = 'none';
  installMenuVisibilityProbe();
  expect(probe().failures).toHaveLength(1);
  expect(JSON.parse(probe().failures[0])[1].painted).toBe(true);
});

test.each(['transparent', 'offscreen', 'clipped', 'hidden button'])(
  'does not count a former owner inside a %s surface as on-screen', kind => {
  local.style.visibility = 'visible';
  if (kind === 'transparent') bar.style.opacity = '0';
  if (kind === 'offscreen') bounds(local, -60);
  if (kind === 'clipped') { slot.style.overflow = 'hidden'; slot.style.overflowX = 'hidden'; bounds(slot, 70, 0); }
  if (kind === 'hidden button') local.style.visibility = 'hidden';
  installMenuVisibilityProbe();
  expect(probe().failures).toEqual([]);
});

test.each(['aria-hidden', 'not tabbable', 'disabled', 'inert ancestor', 'covered'])(
  'rejects a sole on-screen control that is %s', kind => {
  if (kind === 'aria-hidden') source.setAttribute('aria-hidden', 'true');
  if (kind === 'not tabbable') source.tabIndex = -1;
  if (kind === 'disabled') source.disabled = true;
  if (kind === 'inert ancestor') document.body.setAttribute('inert', '');
  if (kind === 'covered') (document.elementFromPoint as ReturnType<typeof vi.fn>).mockReturnValue(bar);
  installMenuVisibilityProbe();
  expect(probe().failures).toHaveLength(1);
});

test('retains a mutation-time failure after the transition settles and samples every frame', async () => {
  installMenuVisibilityProbe();
  expect(probe().failures).toEqual([]);
  local.style.visibility = 'visible';
  await Promise.resolve();
  expect(probe().failures).toHaveLength(1);
  local.style.visibility = 'hidden';
  await Promise.resolve();
  const failures = [...probe().failures];
  source.getAnimations = () => [{ playState: 'running' } as Animation];
  frames.shift()!(0);
  expect(probe().idleFrames).toBe(0);
  source.getAnimations = () => [];
  frames.shift()!(16); frames.shift()!(32);
  expect(probe().frames).toBe(3); expect(probe().idleFrames).toBe(2);
  expect(probe().samples).toBeGreaterThan(3);
  expect(probe().failures).toEqual(failures);
  probe().stop();
  expect(cancelAnimationFrame).toHaveBeenCalled();
});
