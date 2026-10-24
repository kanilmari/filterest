// visual_observer_page.js
// Measures first-wave visual defects in the exact state captured by Playwright.
// Connects reviewed expectations and bounded DOM geometry to report findings.
// Self-contained: Playwright serializes this function without module bindings.

/** Run one bounded in-page pass, or a small post-screenshot geometry recheck. */
export async function observeVisualState(args) {
  const began = performance.now();
  const rect = element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  if (args.fingerprint) {
    return args.fingerprint.map(item => {
      const element = item.selector && document.querySelector(item.selector);
      return { selector: item.selector, rect: element ? rect(element) : null };
    });
  }
  const errors = [], findings = [], images = [], fingerprints = [], scrolls = [];
  const checks = ['image-load', 'image-box', 'image-distortion', 'text-clip', 'page-x-scroll', 'touch-size', 'console', 'request'];
  const coverage = checks.map(check => ({ check, status: 'complete', examined: 0, excluded: 0, reason: null, durationMs: 0 }));
  for (const check of ['overlap', 'offscreen', 'notice-cover', 'contrast']) {
    coverage.push({ check, status: 'skipped', examined: 0, excluded: 0, reason: 'V-3: outside first-wave scope', durationMs: 0 });
  }
  const cov = check => coverage.find(item => item.check === check);
  const partial = (check, reason) => { Object.assign(cov(check), { status: 'partial', reason }); };
  const styleCache = new Map(), rectCache = new Map();
  const style = element => {
    if (!styleCache.has(element)) styleCache.set(element, getComputedStyle(element));
    return styleCache.get(element);
  };
  const box = element => {
    if (!rectCache.has(element)) rectCache.set(element, rect(element));
    return rectCache.get(element);
  };
  const intersect = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) });
  const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
  const root = args.target || document.documentElement;
  const pageCapture = args.fullPage ? { x: -scrollX, y: -scrollY, width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight } : { x: 0, y: 0, width: innerWidth, height: innerHeight };
  // Playwright clips viewport shots in viewport coordinates, full-page shots in document coordinates.
  const capture = args.target ? box(root) : args.clip ? intersect(pageCapture,
    { ...args.clip, x: args.clip.x - (args.fullPage ? scrollX : 0), y: args.clip.y - (args.fullPage ? scrollY : 0) }) : pageCapture;
  const unique = selector => document.querySelectorAll(selector).length === 1;
  const selector = element => {
    if (element.id && unique(`#${CSS.escape(element.id)}`)) return `#${CSS.escape(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId) {
      const candidate = `[data-testid="${CSS.escape(testId)}"]`;
      if (unique(candidate)) return candidate;
    }
    const parts = [];
    for (let current = element; current && parts.length < 4; current = current.parentElement) {
      if (current.id) parts.unshift(`#${CSS.escape(current.id)}`);
      else {
        const siblings = current.parentElement ? [...current.parentElement.children].filter(node => node.tagName === current.tagName) : [current];
        parts.unshift(`${current.localName}:nth-of-type(${siblings.indexOf(current) + 1})`);
      }
      const candidate = parts.join(' > ');
      if (unique(candidate)) return candidate;
    }
    for (const check of checks.slice(0, 6)) partial(check, 'No unique selector within four levels');
    return null;
  };
  const painted = element => {
    const bounds = box(element);
    if (!bounds.width || !bounds.height || !element.getClientRects().length) return false;
    for (let current = element; current; current = current.parentElement) {
      const css = style(current);
      if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0) return false;
    }
    return true;
  };
  const clipped = element => {
    let result = box(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = style(parent), parentBox = box(parent);
      const clipX = /hidden|clip|auto|scroll/.test(css.overflowX);
      const clipY = /hidden|clip|auto|scroll/.test(css.overflowY);
      if (clipX || clipY) result = intersect(result, {
        x: clipX ? parentBox.x + parent.clientLeft : result.x,
        y: clipY ? parentBox.y + parent.clientTop : result.y,
        width: clipX ? parent.clientWidth : result.width, height: clipY ? parent.clientHeight : result.height,
      });
    }
    return result;
  };
  const captured = element => {
    if (!painted(element)) return false;
    const visible = intersect(clipped(element), capture);
    return visible.width > 0 && visible.height > 0;
  };
  const elements = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element = root;
  while (element && elements.length < 2500) { elements.push(element); element = walker.nextNode(); }
  if (elements.length === 2500) for (const check of checks.slice(0, 6)) partial(check, '2500 element cap reached');
  const visible = elements.filter(captured);
  for (const required of args.requiredSelectors || []) {
    if (!visible.some(node => node.matches(required))) {
      errors.push(`Required visual selector missing or not painted: ${required}`);
      for (const check of checks.slice(0, 6)) partial(check, 'Required capture element unavailable');
    }
  }
  const glob = (pattern, name) => pattern === 'any' || new RegExp('^' + pattern.split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);
  const contracts = (args.expectations || []).filter(entry => glob(entry.shot, args.name)
    && viewport.width >= entry.viewport.minWidth && viewport.width <= entry.viewport.maxWidth);
  const expectation = (element, kind) => contracts.find(entry => entry.kind === kind && element.matches(entry.selector));
  const emit = (check, element, rule, measured, expected = {}, intent = null, related = null, severity = 'medium') => {
    findings.push({ check, severity, selector: selector(element), relatedSelector: related ? selector(related) : null,
      rect: box(element), relatedRect: related ? box(related) : null, rule, measured, expected,
      intentSource: intent?.source || null, suppressedBy: null, eventIds: [] });
  };
  const contentBox = element => {
    const bounds = box(element), css = style(element);
    return { width: Math.max(0, bounds.width - ['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight']
      .reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0)),
    height: Math.max(0, bounds.height - ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom']
      .reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0)) };
  };
  const remember = element => {
    const key = selector(element);
    if (key && fingerprints.length < 24 && !fingerprints.some(item => item.selector === key)) {
      fingerprints.push({ selector: key, rect: box(element) });
    }
  };
  remember(root);
  for (const node of visible) {
    if (node.scrollLeft || node.scrollTop) {
      const key = selector(node);
      if (key) scrolls.push({ selector: key, x: node.scrollLeft, y: node.scrollTop });
    }
  }
  scrolls.unshift({ selector: ':root', x: scrollX, y: scrollY });
  const imgElements = visible.filter(node => node instanceof HTMLImageElement && (node.currentSrc || node.getAttribute('src')));
  await Promise.all(imgElements.map(async image => {
    cov('image-load').examined++;
    if (image.loading === 'lazy' && !image.complete && !image.currentSrc) { cov('image-load').excluded++; return; }
    const record = { selector: selector(image), rect: box(image), src: image.currentSrc || image.src, problem: null };
    images.push(record);
    if (!image.complete) { partial('image-load', 'Images still pending after bounded readiness'); return; }
    if (!image.naturalWidth || !image.naturalHeight) record.problem = 'natural-size';
    else {
      const result = await Promise.race([image.decode().then(() => 'ok', () => 'decode'),
        new Promise(resolve => setTimeout(() => resolve('pending'), 100))]);
      if (result === 'pending') partial('image-load', 'Image decode did not settle');
      else if (result === 'decode') record.problem = 'decode';
    }
    if (record.problem) emit('image-load', image, record.problem,
      { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }, {}, null, null, 'high');
  }));
  for (const image of imgElements) {
    remember(image);
    const bounds = box(image), content = contentBox(image), css = style(image);
    cov('image-distortion').examined++;
    if (image.naturalWidth && image.naturalHeight && content.width && content.height && css.objectFit === 'fill') {
      const scaleX = content.width / image.naturalWidth, scaleY = content.height / image.naturalHeight;
      const distortion = Math.max(scaleX / scaleY, scaleY / scaleX);
      if (distortion > 1.10) emit('image-distortion', image, 'object-fit-fill', { scaleX, scaleY, distortion }, { maxRatio: 1.10 });
    }
    let remaining = bounds, blocker = null;
    for (let parent = image.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = style(parent), parentBox = box(parent);
      const clipX = /hidden|clip/.test(parentStyle.overflowX), clipY = /hidden|clip/.test(parentStyle.overflowY);
      if (clipX || clipY) {
        remaining = intersect(remaining, { x: clipX ? parentBox.x + parent.clientLeft : remaining.x,
          y: clipY ? parentBox.y + parent.clientTop : remaining.y,
          width: clipX ? parent.clientWidth : remaining.width, height: clipY ? parent.clientHeight : remaining.height });
        if (remaining.width * remaining.height / (bounds.width * bounds.height) < .90) { blocker = parent; break; }
      }
    }
    if (blocker) emit('image-box', image, 'ancestor-clip',
      { visibleFraction: remaining.width * remaining.height / (bounds.width * bounds.height) }, { minimumVisibleFraction: .90 }, null, blocker);
  }
  const compared = new Set();
  const compare = (node, contract, frame = null) => {
    if (compared.has(node)) return;
    compared.add(node); cov('image-box').examined++; remember(node);
    const actual = contract.box === 'content' ? contentBox(node) : box(node);
    const widthError = actual.width - contract.width, heightError = actual.height - contract.height;
    const ratioError = Math.abs((actual.width / actual.height) / (contract.width / contract.height) - 1);
    if (Math.abs(widthError) > Math.max(2, .05 * contract.width)
      || Math.abs(heightError) > Math.max(2, .05 * contract.height) || ratioError > .10) {
      emit('image-box', node, 'expected-box', { width: actual.width, height: actual.height, widthError, heightError, ratioError },
        { width: contract.width, height: contract.height, box: contract.box }, contract, frame);
    }
  };
  for (const contract of contracts.filter(entry => entry.kind === 'image-box')) {
    for (const frame of visible.filter(node => node.matches(contract.selector))) {
      compare(frame, contract);
      for (const image of imgElements.filter(image => frame.contains(image) && image !== frame)) compare(image, contract, frame);
    }
  }
  for (const image of imgElements.filter(image => !compared.has(image))) {
    const cssRatio = style(image).aspectRatio;
    if (cssRatio !== 'auto' && !cssRatio.startsWith('auto')) {
      const [width, height = 1] = cssRatio.split('/').map(Number), actual = contentBox(image);
      if (width > 0 && height > 0 && actual.height > 0) {
        cov('image-box').examined++;
        const ratioError = Math.abs((actual.width / actual.height) / (width / height) - 1);
        if (ratioError > .10) emit('image-box', image, 'css-aspect-ratio', { ratioError }, { ratio: width / height });
        continue;
      }
    }
    cov('image-box').excluded++;
    if (cov('image-box').status === 'complete') Object.assign(cov('image-box'), { status: 'skipped', reason: 'not checked: no reviewed image-box expectation or CSS aspect-ratio' });
  }
  // Assign each text fragment to its nearest text-bearing box, avoiding duplicate ancestors.
  const textOwners = new Set(), textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode, fragments = 0, textNodes = 0;
  while ((textNode = textWalker.nextNode())) {
    if (++textNodes >= 2000) { partial('text-clip', '2000 text node traversal bound reached'); break; }
    if (!textNode.textContent.trim()) continue;
    let owner = textNode.parentElement;
    while (owner && style(owner).display === 'inline') owner = owner.parentElement;
    if (!owner || !visible.includes(owner) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(owner.tagName)) continue;
    const range = document.createRange(); range.selectNodeContents(textNode);
    fragments += range.getClientRects().length;
    textOwners.add(owner);
    for (let parent = owner.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (visible.includes(parent) && /hidden|clip/.test(style(parent).overflow)) textOwners.add(parent);
    }
    if (fragments >= 2000) { partial('text-clip', '2000 text fragment cap reached'); break; }
  }
  const clippedText = [];
  for (const node of textOwners) {
    cov('text-clip').examined++;
    const css = style(node), horizontal = node.scrollWidth - node.clientWidth, vertical = node.scrollHeight - node.clientHeight;
    const lineHeight = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2;
    const clamp = parseInt(css.webkitLineClamp, 10) || 0;
    const ellipsis = css.textOverflow === 'ellipsis';
    const contract = expectation(node, 'truncation');
    if (contract && (clamp === contract.lines || ellipsis && contract.lines === 1)
      && node.clientHeight <= lineHeight * contract.lines + 2) { cov('text-clip').excluded++; continue; }
    const x = !/auto|scroll/.test(css.overflowX) && horizontal > Math.max(2, .05 * node.clientWidth);
    const y = /hidden|clip/.test(css.overflowY) && vertical > 2 && vertical >= .5 * lineHeight;
    if (x || y) {
      clippedText.push({ node, clamp, ellipsis, horizontal, vertical, lineHeight });
    }
  }
  for (const item of clippedText) {
    const { node, clamp, ellipsis, horizontal, vertical, lineHeight } = item;
    if (!clippedText.some(child => child.node !== node && node.contains(child.node))) {
      emit('text-clip', node, clamp ? 'unapproved-clamp' : ellipsis ? 'unapproved-ellipsis' : 'overflow',
        { horizontal, vertical, lineHeight, clamp }, { horizontalTolerance: Math.max(2, .05 * node.clientWidth), verticalTolerance: 2 });
      remember(node);
    }
  }
  if (innerWidth <= 700) {
    cov('page-x-scroll').examined = 1;
    const excess = (document.scrollingElement?.scrollWidth || 0) - document.documentElement.clientWidth;
    if (excess > 4) {
      const protruders = visible.filter(node => {
        if (['HTML', 'BODY'].includes(node.tagName)) return false;
        const bounds = box(node);
        if (bounds.x >= -4 && bounds.x + bounds.width <= document.documentElement.clientWidth + 4) return false;
        for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (/auto|scroll/.test(style(parent).overflowX)) return false;
        }
        return true;
      }).sort((a, b) => box(b).x + box(b).width - box(a).x - box(a).width).slice(0, 5);
      const measured = { excess, rootOverflowX: style(document.documentElement).overflowX,
        bodyOverflowX: document.body ? style(document.body).overflowX : 'unknown' };
      protruders.forEach((node, index) => { measured[`protruding${index + 1}`] = selector(node); remember(node); });
      emit('page-x-scroll', document.documentElement, 'root-overflow', measured, { tolerance: 4 });
    }
  } else Object.assign(cov('page-x-scroll'), { status: 'skipped', reason: 'Viewport above 700px' });
  const actionSelector = 'button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"]';
  const sameAction = (hit, action) => hit && (hit === action || action.contains(hit)
    || hit.closest('label')?.control === action);
  const hitTests = (bounds, action) => {
    const inset = Math.min(2, bounds.width / 4, bounds.height / 4);
    return [[bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
      [bounds.x + inset, bounds.y + inset], [bounds.x + bounds.width - inset, bounds.y + inset],
      [bounds.x + inset, bounds.y + bounds.height - inset], [bounds.x + bounds.width - inset, bounds.y + bounds.height - inset]]
      .every(([x, y]) => sameAction(document.elementFromPoint(x, y), action));
  };
  let unexaminedTouchTargets = 0;
  for (const action of visible.filter(node => node.matches(actionSelector) || expectation(node, 'expanded-target'))) {
    const css = style(action);
    if (action.matches(':disabled') || action.closest('[inert],[aria-hidden="true"],[aria-disabled="true"]') || css.pointerEvents === 'none') {
      cov('touch-size').excluded++; continue;
    }
    if (action.matches('a[href]') && css.display === 'inline') {
      let prose = false;
      for (let inline = action; inline?.parentElement; inline = inline.parentElement) {
        prose ||= [...inline.parentElement.childNodes].some(node => node !== inline
          && node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (style(inline.parentElement).display !== 'inline') break;
      }
      if (prose) { cov('touch-size').excluded++; continue; }
    }
    const original = intersect(clipped(action), capture);
    const hit = document.elementFromPoint(original.x + original.width / 2, original.y + original.height / 2);
    // Full-page captures include controls outside viewport-based hit testing.
    // No hit is missing evidence, not proof that an in-scope control is covered.
    if (!hit) { unexaminedTouchTargets++; cov('touch-size').excluded++; continue; }
    if (!sameAction(hit, action)) {
      cov('touch-size').excluded++; continue;
    }
    cov('touch-size').examined++;
    let effective = original;
    const contract = expectation(action, 'expanded-target');
    if (contract) {
      const pseudo = getComputedStyle(action, contract.via);
      if (pseudo.content !== 'none' && pseudo.position === 'absolute') {
        let containing = style(action).position !== 'static' ? action : action.parentElement;
        while (containing && style(containing).position === 'static') containing = containing.parentElement;
        if (containing) {
          const container = box(containing);
          const left = parseFloat(pseudo.left), top = parseFloat(pseudo.top);
          const width = parseFloat(pseudo.width), height = parseFloat(pseudo.height);
          const expanded = { x: container.x + containing.clientLeft + left,
            y: container.y + containing.clientTop + top, width, height };
          if ([left, top, width, height].every(Number.isFinite) && width > 0 && height > 0 && hitTests(expanded, action)) effective = expanded;
          else partial('touch-size', 'Registered expanded target could not be confirmed by five hit tests');
        }
      }
    }
    if (action.labels?.length) {
      for (const label of action.labels) {
        if (!captured(label)) continue;
        const bounds = box(label), combined = { x: Math.min(effective.x, bounds.x), y: Math.min(effective.y, bounds.y),
          width: Math.max(effective.x + effective.width, bounds.x + bounds.width) - Math.min(effective.x, bounds.x),
          height: Math.max(effective.y + effective.height, bounds.y + bounds.height) - Math.min(effective.y, bounds.y) };
        if (hitTests(combined, action)) effective = combined;
      }
    }
    const minimum = innerWidth <= 700 ? 43.5 : 24;
    if (effective.width < minimum || effective.height < minimum) {
      emit('touch-size', action, 'effective-target', { width: effective.width, height: effective.height }, { minimum }, contract);
      remember(action);
    }
  }
  if (unexaminedTouchTargets) {
    const reason = `${unexaminedTouchTargets} captured touch targets not examined: no viewport hit-test evidence`;
    partial('touch-size', [cov('touch-size').reason, reason].filter(Boolean).join('; '));
  }
  const selectors = (args.allowlistSelectors || []).filter(key => document.querySelector(key));
  const theme = document.body?.classList.contains('dark-mode') ? 'dark'
    : document.body?.classList.contains('light-mode') ? 'light' : 'unknown';
  const durationMs = performance.now() - began;
  for (const item of coverage) item.durationMs = durationMs;
  return { findings, coverage, errors, images, fingerprint: fingerprints, selectors, viewport, theme,
    osTheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    language: document.documentElement.lang || 'unknown', scrolls,
    target: args.target ? selector(args.target) : null };
}
