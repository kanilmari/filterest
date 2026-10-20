// T24_article_presentations.spec.ts
// Proves one real atomic Save/readback and phone keyboard/localization behavior.
// Uses only e2e_ datasets with failure teardown and context-local visual preferences.
import { expect,test } from '@playwright/test';
import { ARTICLE_EDITOR_ROUTE, ARTICLE_VIEWS, articleGet, withArticleFixture, openArticleEditor, uncheckArticleCell } from '../helpers/article-presentations-fixture';

test('K383SingleSaveReadback',async({page})=>{
  test.setTimeout(120_000); // Shared K383 setup/reload/teardown path: the desktop mixed-target fixture passed at 120s (d246).
  await withArticleFixture(page,async({dataset})=>{
    await openArticleEditor(page,dataset);
    const baseline=await articleGet(page,dataset);
    const first=baseline.targets[0].members[0].column_uid;
    const row=page.locator(`[data-row-id="field:${first}"]`);
    await row.locator('[data-delta="1"]').click();
    for(const key of ARTICLE_VIEWS) await uncheckArticleCell(page,`field:${first}`,key);
    await uncheckArticleCell(page,'block:images','article_view');
    const expected=structuredClone(baseline.targets[0].members);
    [expected[0],expected[1]]=[expected[1],expected[0]];
    for(const key of ARTICLE_VIEWS)expected.find((member:any)=>member.column_uid===first).values[key].visible=false;
    const responsePromise=page.waitForResponse(response=>response.url().includes(ARTICLE_EDITOR_ROUTE)&&response.request().method()==='POST');
    await page.getByTestId('view-field-assignments-save').click();
    const response=await responsePromise;expect(response.status()).toBe(200);
    const committed=await response.json();
    await expect(page.getByTestId('view-field-assignments-status')).toHaveText(/saved and verified|tallennettu ja varmistettu|已保存并验证/);
    expect(committed.targets[0].members).toEqual(expected);expect(committed.blocks.article_view.images).toBe(false);
    expect(await articleGet(page,dataset)).toEqual(committed);
    await page.reload({waitUntil:'domcontentloaded'});await openArticleEditor(page,dataset);
    expect(await articleGet(page,dataset)).toEqual(committed);
    expect(await page.locator('.vct-row[data-row-id^="field:"]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.rowId)))
      .toEqual(expected.map((member:any)=>`field:${member.column_uid}`));
    await expect(page.locator('[data-row-id="block:images"] input[data-column-key="article_view"]')).not.toBeChecked();
  });
});

test('K383PhoneKeyboardFIENZH',async({page},testInfo)=>{
  test.setTimeout(120_000); // Same slow owned fixture as the desktop 120s pass, plus six locale/theme reloads.
  test.skip(!testInfo.project.name.startsWith('mobile'),'Phone project proof');
  await withArticleFixture(page,async({dataset})=>{
    const backgrounds:string[]=[];
    // Prove every interface language this instance offers to the application (/api/ui-languages: enabled and
    // public-selector-ready; the dev server offers fi and en). A language it does not offer falls back to English, so
    // it cannot be proven here. The Chinese copy (ch/zh/yue) is covered by article_presentations_table.test.js.
    const COPY:Record<string,{all:string;position:string}>={fi:{all:'Valitse kaikki',position:'sijainti 2/'},
      en:{all:'Select all',position:'position 2 of'},ch:{all:'全选',position:'第 2 项'},yue:{all:'全選',position:'第 2 項'}};
    const catalog=await (await page.request.get('/api/ui-languages')).json();
    const locales=(catalog.languages||[]).filter((language:any)=>language.is_enabled&&language.public_selector_ready)
      .map((language:any)=>String(language.language_code)).filter((code:string)=>code in COPY);
    expect(locales,'the instance must offer at least Finnish and English').toEqual(expect.arrayContaining(['fi','en']));
    for(const locale of locales) for(const theme of ['light','dark'] as const){
      await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});
      await page.evaluate(({locale,theme})=>{localStorage.setItem('chosen_language',locale);localStorage.setItem('theme',theme);},{locale,theme});
      // Account theme is served locally, never saved on the owner's account.
      await page.unroute('**/api/user-visual-preference');
      await page.route('**/api/user-visual-preference',async route=>{
        expect(route.request().method()).toBe('GET');await route.fulfill({json:{theme_mode:theme,revision:1,configured:true}});
      });
      await page.reload({waitUntil:'domcontentloaded'});await openArticleEditor(page,dataset);
      await expect(page.locator('.article-presentations-table thead th')).toHaveCount(5);
      await expect(page.locator('.article-presentations-table thead th').last()).toHaveText(COPY[locale].all);
      const row=page.locator('.vct-row[data-row-id^="field:"]').first(),identity=await row.getAttribute('data-row-id');
      const down=row.locator('[data-delta="1"]');await down.focus();await page.keyboard.press('Enter');
      await expect(page.locator(`[data-row-id="${identity}"] [data-delta="1"]`)).toBeFocused();
      await expect(page.locator('.vct-announcement')).toContainText(COPY[locale].position);
      const metrics=await page.locator('.article-presentations-table').evaluate(root=>{
        const scroll=root.querySelector('.vct-table-wrapper') as HTMLElement,cell=root.querySelector('.vct-row th') as HTMLElement;
        scroll.scrollLeft=170;
        return {scrollable:scroll.scrollWidth>scroll.clientWidth,identityVisible:cell.getBoundingClientRect().left>=scroll.getBoundingClientRect().left-1,
          sticky:getComputedStyle(cell).position,control:(root.querySelector('.vct-move') as HTMLElement).getBoundingClientRect().height,
          background:getComputedStyle(cell).backgroundColor,maxHeight:getComputedStyle(scroll).maxHeight,
          scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,scrollLeft:scroll.scrollLeft,
          identityLeft:cell.getBoundingClientRect().left,wrapperLeft:scroll.getBoundingClientRect().left};
      });
      expect(metrics, JSON.stringify(metrics)).toMatchObject({scrollable:true,identityVisible:true,sticky:'sticky',maxHeight:'none'});
      expect(metrics.control, JSON.stringify(metrics)).toBeGreaterThanOrEqual(44);
      backgrounds.push(metrics.background);
      await page.getByTestId('article-presentations-cancel').scrollIntoViewIfNeeded();await expect(page.getByTestId('article-presentations-cancel')).toBeInViewport();
      await page.getByTestId('article-presentations-cancel').click();
    }
    for(let i=0;i<backgrounds.length;i+=2)expect(backgrounds[i]).not.toBe(backgrounds[i+1]);
  });
});
