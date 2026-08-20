/**
 * P3_table_range_and_multiline_editor.spec.ts
 * Proves table-view vertical range selection and cell-sized multiline editing in a real browser.
 * Bridges a temporary dataset with the shared grid adapter and inline cell editor.
 * Exists to prevent the table surface from regressing behind the list surface's selection UX.
 */

import { expect, test } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('P3 — Table Range And Multiline Editor', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('selects cells vertically and opens wrapped text in a cell-sized textarea', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_table_range_textarea');
    const longDescription = [
      'This is a deliberately long first paragraph used to wrap across several visible lines.',
      'The second line proves that explicit line breaks remain editable as multiline content.',
    ].join('\n');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        description: 'TEXT',
      },
      seedRows: [
        { title: 'First', description: longDescription },
        { title: 'Second', description: `${longDescription}\nSecond row.` },
        { title: 'Third', description: 'Short control row.' },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const descriptionCells = page.locator(
        `#${datasetName}_table_view_container td.table_data_cell[data-column="description"]`,
      );
      await expect(descriptionCells).toHaveCount(3, { timeout: 10000 });

      const firstBox = await descriptionCells.nth(0).boundingBox();
      const secondBox = await descriptionCells.nth(1).boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();

      await page.mouse.move(firstBox!.x + 8, firstBox!.y + 8);
      await page.mouse.down();
      await page.mouse.move(secondBox!.x + 8, secondBox!.y + 8, { steps: 4 });
      await page.mouse.up();

      const selectedDescriptionCells = page.locator(
        `#${datasetName}_table_view_container td.table_data_cell[data-column="description"].selected`,
      );
      await expect(selectedDescriptionCells).toHaveCount(2);
      await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() || '')).toBe('');
      const visibleSelectionStyle = await selectedDescriptionCells.first().evaluate((cell) => {
        const style = getComputedStyle(cell);
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
        };
      });
      expect(visibleSelectionStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(visibleSelectionStyle.boxShadow).not.toBe('none');

      const sameCellTextSelection = await descriptionCells.nth(2).evaluate((cell) => {
        const textNode = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT).nextNode();
        if (!(textNode instanceof Text) || !textNode.data.length) {
          return { defaultPrevented: true, selectedText: '' };
        }

        cell.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
        }));
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.data.length));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const moveEvent = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          buttons: 1,
        });
        cell.dispatchEvent(moveEvent);
        const selectedText = selection?.toString() || '';
        cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        selection?.removeAllRanges();
        return {
          defaultPrevented: moveEvent.defaultPrevented,
          selectedText,
        };
      });
      expect(sameCellTextSelection).toEqual({
        defaultPrevented: false,
        selectedText: 'Short',
      });

      const firstCellInnerSize = await descriptionCells.first().evaluate((cell) => {
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return {
          height: rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          width: rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        };
      });

      await descriptionCells.first().dblclick();
      const textarea = page.locator(
        `#${datasetName}_table_view_container textarea[data-testid="table-editor"]`,
      );
      await expect(textarea).toBeVisible({ timeout: 3000 });
      await expect(textarea).toHaveValue(longDescription);

      const editorSize = await textarea.evaluate((editor) => ({
        height: editor.getBoundingClientRect().height,
        width: editor.getBoundingClientRect().width,
      }));
      expect(editorSize.width).toBeGreaterThanOrEqual(firstCellInnerSize.width - 2);
      expect(editorSize.height).toBeGreaterThanOrEqual(firstCellInnerSize.height - 2);

      await textarea.press('Escape');
      await expect(descriptionCells.first()).toContainText(longDescription);
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
