// checkbox_table_browser.test.js
// Proves opt-in table keyboard, focus, translated copy and opposite-OS themes offline.
// Bundles the real component into intercepted in-memory documents; no server is used.
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';
const { chromium } = requireNodeDependency('playwright');
const { build } = requireNodeDependency('esbuild');
const frontendRoot = fileURLToPath(new URL('../../', import.meta.url));
const styles = ['styles/variables.css', 'reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.css']
    .map(path => readFileSync(frontendRoot + path, 'utf8')).join('\n');
const copy = {
    en: ['Fields', 'Blocks', 'Field UID', 'Article', 'Image first', 'Page sized image first', 'Select all', 'Up', 'Down', 'Clear search', 'position', 'Not supported'],
    fi: ['Kentät', 'Lohkot', 'Kenttä UID', 'Artikkeli', 'Kuvapainotteinen artikkeli', 'Sivukokoinen kuvapainotteinen artikkeli', 'Valitse kaikki', 'Ylös', 'Alas', 'Poista haku', 'sijainti', 'Ei tuettu'],
    zh: ['字段', '区块', '字段标识', '文章', '图片优先文章', '页面大小的图片优先文章', '全选', '上移', '下移', '清除搜索', '位置', '不支持'],
};

describe.runIf(process.env.FILTEREST_TEST_ISOLATED_BROWSER === '1')('shared settings table offline browser', () => {
    let browser, bundle;
    beforeAll(async () => {
        const result = await build({ stdin: { resolveDir: frontendRoot, contents: `
            import { createVanillaCheckboxTable } from './reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.js';
            window.mountTable = labels => {
                const columns = [{key:'identity',label:labels[2],type:'static'},
                    ...['a','b','c'].map((key,index)=>({key,label:labels[index+3],isCellSupported:({row})=>row.kind==='fields'||key==='a'})),
                    {key:'all',label:labels[6],rowToggle:{columns:['a','b','c']}}];
                window.table = createVanillaCheckboxTable({containerElement:document.querySelector('main'),columns,
                    rows:[{id:'a',identity:'Otsikko 标题 UID:a',kind:'fields',a:true,b:false,c:true},
                        {id:'b',identity:'Summary 摘要 UID:b',kind:'fields',a:false,b:false,c:false},
                        {id:'block',identity:labels[1],kind:'blocks',a:true}],
                    startInEditMode:true,rowGroupKey:'kind',rowHeaderKey:'identity',
                    rowGroups:[{key:'fields',label:labels[0]},{key:'blocks',label:labels[1]}],
                    reorder:{group:'fields',inColumn:'identity',labels:{up:labels[7],down:labels[8],filtered:labels[9],
                        position:({name,position,count})=>name+' '+labels[10]+' '+position+'/'+count}},
                    cellAccessibleName:({groupLabel,row,column})=>groupLabel+' '+row.identity+' '+column.label,
                    renderUnsupportedCell:()=>{const node=document.createElement('span');node.textContent='—';node.setAttribute('aria-label',labels[11]);return node;}
                });
            };` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
        bundle = result.outputFiles[0].text;
        browser = await chromium.launch({ executablePath: process.env.FILTEREST_TEST_CHROMIUM_EXECUTABLE || undefined,
            args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    });
    afterAll(async () => { await browser?.close(); });
    test.each([375, 768, 1440].flatMap(width => Object.keys(copy).flatMap(language => ['light', 'dark'].map(theme => ({ width, language, theme })))))('$width $language $theme opposite OS', async ({ width, language, theme }) => {
            const context = await browser.newContext({ viewport: { width, height: 667 }, colorScheme: theme === 'light' ? 'dark' : 'light', serviceWorkers: 'block' });
            try {
                await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html>' }));
                const page = await context.newPage();
                await page.goto('https://settings-table.invalid/');
                await page.setContent(`<style>${styles}</style><body class="${theme}-mode" style="margin:0"><main></main></body>`);
                await page.addScriptTag({ content: bundle });
                await page.evaluate(labels => window.mountTable(labels), copy[language]);
                const down = page.locator('[data-row-id="a"] button[data-delta="1"]');
                await down.focus(); await page.keyboard.press('Enter');
                expect(await down.evaluate(node => node === document.activeElement)).toBe(true);
                expect(await down.getAttribute('aria-disabled')).toBe('true');
                await page.keyboard.press('Space'); // Guarded boundary remains focused and unchanged.
                expect(await page.evaluate(() => window.table.getChangeSet().order)).toEqual(['b', 'a', 'block']);
                const up = page.locator('[data-row-id="a"] button[data-delta="-1"]');
                await up.focus(); await page.keyboard.press('Space');
                expect(await up.evaluate(node => node === document.activeElement)).toBe(true);
                expect(await page.locator('[role="status"]').textContent()).toContain('1/2');
                const bounds = await up.boundingBox(); expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
                const wrapper = await page.locator('.vct-table-wrapper').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
                expect(wrapper.width).toBeLessThanOrEqual(width);
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
                if (width === 375) expect(wrapper.scroll).toBeGreaterThan(wrapper.width);
                const colors = await up.evaluate(node => ({ fg: getComputedStyle(node).color, bg: getComputedStyle(node).backgroundColor }));
                expect(colors.fg).not.toBe(colors.bg);
                expect(await page.locator('[aria-label="' + copy[language][11] + '"]').count()).toBe(2);
            } finally { await context.close(); }
        }, 15000);
});
