// heading-appearance-baseline.ts
// Preserves the audited heading declarations from the worktree before J17 edits.
// Connects legacy native tags to computed-style comparisons in the real native page.
// These frozen rules supplement the page's unchanged theme and ancestor styles.
import { expect, type Locator } from '@playwright/test';

const legacyHeadingCss = `
.map-view-list-shell h3 {
    margin: 0;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid var(--map-view-border);
    font-size: 1rem;
    line-height: 1.3;
}

.map-view-empty h3,
.map-view-empty p {
    margin: 0;
}

.map-view-empty h3 {
    font-size: 1.1rem;
}

.price-chart-view__title {
  margin: 0;
  font-size: 1.08rem;
  line-height: 1.25;
}

.price-chart-view__notice h3 {
  margin: 0;
  font-size: 1rem;
}

.favefox-filterbar .filter-header h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 650;
    color: var(--fw-color-text);
}

.favefox-filterbar--inline-open .filter-header--static h3 {
    line-height: 1.2;
}

.filterbar-panel-body .favefox-filterbar--inline-open .filter-header--static h3 {
  line-height: 1.2;
}

.calendar-view__week-day-heading {
  margin: 0;
  border-bottom: 1px solid var(--calendar-border);
  background: var(--calendar-panel);
  font-size: 0.9rem;
  line-height: 1.25;
  padding: 10px;
  text-align: center;
}

.calendar-view__day-heading {
  margin: 0;
  border-bottom: 1px solid var(--calendar-border);
  background: var(--calendar-panel);
  font-size: 0.98rem;
  line-height: 1.3;
  padding: 10px 12px;
}

.product-card-view-title {
    display: -webkit-box;
    min-height: 2.6em;
    margin: 0;
    overflow: hidden;
    color: var(--text_color);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.3;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.big_card_attachment_title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
}

.big_card_attachment_preview_title {
    margin: 0;
    font-size: 1rem;
}
`;

/** Record the old tag/rules first in the same DOM position, then read the new heading. */
export async function compareHeadingAppearance(headings: Locator, oldTag = 'h3') {
  const count = await headings.count();
  expect(count, 'The proof must exercise at least one rendered heading').toBeGreaterThan(0);
  const records = [];
  for (let index = 0; index < count; index += 1) {
    await expect(headings.nth(index), "Compare visible headings in the actual page").toBeVisible();
    const record = await headings.nth(index).evaluate((heading, { oldTag, legacyHeadingCss }) => {
      const properties = ['font-size', 'font-weight', 'line-height', 'margin-top', 'margin-right',
        'margin-bottom', 'margin-left', 'color', 'font-family', 'font-style', 'letter-spacing',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'background-color'];
      const read = (element: Element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]));
      };
      const previous = document.createElement(oldTag);
      for (const { name, value } of heading.attributes) previous.setAttribute(name, value);
      // This class was introduced only to preserve the standalone notice's old h3 size.
      previous.classList.remove('chart-unavailable-title');
      previous.innerHTML = heading.innerHTML;
      const baselineStyle = document.createElement('style');
      baselineStyle.textContent = legacyHeadingCss;
      heading.replaceWith(previous);
      document.head.appendChild(baselineStyle);
      let before: Record<string, string>;
      try { before = read(previous); }
      finally { baselineStyle.remove(); previous.replaceWith(heading); }
      return { name: heading.textContent, oldTag, newTag: heading.tagName.toLowerCase(),
        before, after: read(heading) };
    }, { oldTag, legacyHeadingCss });
    records.push(record);
    expect(record.after, `${record.name}: computed appearance must match the original heading`).toEqual(record.before);
  }
  return records;
}
