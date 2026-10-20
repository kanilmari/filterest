// article-presentations-fixture.ts
// Owns isolated article editor datasets and optional synthetic groups for browser proofs.
// Connects supported APIs and real field settings while preserving existing rights/settings.
// Teardown attempts every owned artifact even when setup or an assertion fails.
import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials } from './auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest } from './temp-dataset';
import { expandAdminTreeFolder, openAdminTreeButton } from './admin-navigation';
import { ensureNavbarVisible } from './navbar';
import { NAVBAR_WIDTH_THRESHOLD } from '../../../frontend/ui_config.js';
export const ARTICLE_EDITOR_ROUTE = '/api/admin/view-field-settings/article-presentations';
export const ARTICLE_VIEWS = ['article_view','image_first_view','image_first_page_view'];
export async function articleGet(page: Page, dataset: string, targets = 'site'): Promise<any> {
  const response = await page.request.get(`${ARTICLE_EDITOR_ROUTE}?${new URLSearchParams({dataset,targets})}`);
  expect(response.ok(),await response.text()).toBe(true);return response.json();
}
export async function uncheckArticleCell(page:Page,rowID:string,viewKey:string) {
  const input=page.locator(`[data-row-id="${rowID}"] input[data-column-key="${viewKey}"]`);
  // Centre vertically and use the free right edge of the horizontal scroller;
  // its left side belongs to the sticky identity column. Keep native actionability.
  await input.evaluate(element=>element.closest('.vct-control-target')!.scrollIntoView({block:'center',inline:'end'}));
  await input.uncheck();
}
export async function articlePost(page: Page, snapshot: any) {
  const body = structuredClone(snapshot);delete body.fields;delete body.actor_id;
  if (body.targets[0].scope !== 'site') delete body.blocks;
  return page.request.post(ARTICLE_EDITOR_ROUTE,{headers:{'X-CSRF-Token':await fetchCsrfTokenForRequest(page.request)},data:body});
}
async function rows(page: Page,dataset:string,field:string,value:string|number):Promise<any[]> {
  const query = new URLSearchParams({dataset,view_key:'table',[`${field}_from`]:String(value),[`${field}_to`]:String(value)});
  const response=await page.request.get(`/api/get-results?${query}`);expect(response.ok(),await response.text()).toBe(true);
  const result=(await response.json()).data;expect(Array.isArray(result)).toBe(true);
  expect(result.every((row:any)=>String(row[field])===String(value))).toBe(true);return result;
}
async function remove(page:Page,dataset:string,ids:number[]) {
  if (!ids.length) return;
  const response=await page.request.post(`/api/delete-rows?dataset=${dataset}`,{headers:{'X-CSRF-Token':await fetchCsrfTokenForRequest(page.request)},data:{ids}});
  expect(response.ok(),await response.text()).toBe(true);
}
export async function withArticleFixture(page:Page,run:(fixture:{dataset:string;groups:number[]})=>Promise<void>,withGroups=false) {
  await login(page,loadCredentials());
  const dataset=buildTempDatasetName('e2e_k383'),groups:number[]=[],groupNames:string[]=[];
  let created=false,primary:unknown;
  try {
    await createTempDataset(page,{datasetName:dataset,columns:{id:'SERIAL',title:'TEXT',body:'TEXT'}});created=true;
    if (withGroups) for (const suffix of ['a','b']) {
      const name=`${dataset}_${suffix}`;expect(await rows(page,'system_user_groups','name',name)).toEqual([]);groupNames.push(name);
      const response=await page.request.post('/api/add-row-multipart?dataset=system_user_groups',{
        headers:{'X-CSRF-Token':await fetchCsrfTokenForRequest(page.request)},multipart:{jsonPayload:JSON.stringify({name})}});
      expect(response.status(),await response.text()).toBe(201);
      const result=await rows(page,'system_user_groups','name',name);expect(result).toHaveLength(1);groups.push(Number(result[0].id));
    }
    // Table specs are read at application startup; API dataset creation needs a reload.
    await page.reload({waitUntil:'domcontentloaded'});await run({dataset,groups});
  } catch(error) {primary=error;}
  const failures:unknown[]=primary?[primary]:[];
  if(created) try {await dropTempDataset(page,dataset);}catch(error){failures.push(error);}
  for(const [index,name] of groupNames.entries()) try {
    expect(name.startsWith('e2e_')).toBe(true);
    const found=await rows(page,'system_user_groups','name',name);expect(found.length).toBeLessThanOrEqual(1);
    if(!found.length)continue;if(groups[index])expect(Number(found[0].id)).toBe(groups[index]);
    const rights=await rows(page,'system_group_table_func_rights','user_group_id',found[0].id);
    await remove(page,'system_group_table_func_rights',rights.map(row=>Number(row.id)));
    await remove(page,'system_user_groups',[Number(found[0].id)]);
    expect(await rows(page,'system_user_groups','name',name)).toEqual([]);
  }catch(error){failures.push(error);}
  if(failures.length) {
    const details=failures.map((error,index)=>`[${index}] ${String(error instanceof Error?error.message:error).split('\n').slice(0,3).join(' / ')}`);
    throw new AggregateError(failures,`K383 fixture failed or could not be removed: ${details.join(' || ')}`);
  }
}
export async function openArticleEditor(page:Page,dataset:string,groups?:number[]) {
  await ensureNavbarVisible(page);await expandAdminTreeFolder(page,'table_tools');await openAdminTreeButton(page,'view_field_settings');
  await expect(page.getByTestId('view-field-assignments')).toBeVisible();
  // Admin selection leaves the shared menu open. Dismiss its overlay through
  // the real closer before interacting with the editor on narrow layouts.
  // Only the phone and tablet projects do this: the desktop project (1440 px)
  // is also below the 1850 px breakpoint, but its menu is left untouched.
  const narrowProject=/^(mobile|tablet)-/.test(test.info().project.name);
  if(narrowProject&&await page.evaluate(width=>window.innerWidth<width,NAVBAR_WIDTH_THRESHOLD)) {
    const navbar=page.locator('#navbar');
    if(!/(?:^|\s)collapsed(?:\s|$)/.test(await navbar.getAttribute('class')||'')) await page.locator('#hideMenuButton').click();
    await expect(navbar).toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
    await expect(navbar).not.toBeInViewport();
  }
  await page.getByTestId('view-field-assignments-view').selectOption('article_view');
  await page.evaluate(name=>{
    const root=document.getElementById('view_field_assignments_dataset_tree');
    const label=[...root!.querySelectorAll('[data-lang-key]')].find(node=>(node as HTMLElement).dataset.langKey===name);
    const leaf=label?.closest('.node[data-table-uid]');if(!leaf)throw new Error('Missing fixture dataset in tree');
    document.dispatchEvent(new CustomEvent('checkboxSelectionChanged',{detail:{selectedCategories:[leaf.id]}}));
  },dataset);
  await expect(page.getByTestId('article-presentations-table')).toBeVisible();
  if(groups) {
    await page.evaluate(ids=>{
      const picker=document.getElementById('view_field_assignments_group_picker') as HTMLElement & {__dropdown?:{setValue:(value:any,notify:boolean)=>void}};
      picker.__dropdown!.setValue({includeValues:ids.map(String),excludeValues:[]},true);
    },groups);
    await expect(page.getByTestId('article-presentations-table')).toBeVisible();
  }
  await expect(page.getByTestId('view-field-assignments-status')).not.toHaveText(/Loading|Ladataan/);
}
