// @vitest-environment jsdom
// Verifies article-default drafts, scoped saves and exact readback in the real panel.
// Connects fake typed API responses with DOM interactions and language changes.
// Protects dataset/presentation boundaries and preserves unrelated field-set state.
import {afterEach,beforeEach,describe,expect,test,vi} from 'vitest';
const mocks=vi.hoisted(()=>({language:vi.fn(),success:vi.fn(),warning:vi.fn()}));
vi.mock('../endpoints/stable_endpoint_router.js',()=>({getArticleSectionDefaults:vi.fn(),saveArticleSectionDefaults:vi.fn()}));
vi.mock('../state_stores/lang_preference_reader.js',()=>({getLanguageWithBrowserFallback:mocks.language}));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js',()=>({showSuccessToast:mocks.success,showWarningToast:mocks.warning}));
import {createArticleSectionDefaultsPanel} from './article_section_defaults_panel.js';
const panels=[];
const keys={classic:['details','images','attachments','related_rows','task_progress'],image_first:['details']};
function response(dataset='a',presentation='classic',overrides={},canEdit=true){
 return {dataset,presentation_key:presentation,supported_sections:keys[presentation],overrides:{...overrides},
  initial_open:Object.fromEntries(keys[presentation].map(key=>[key,overrides[key]??true])),can_edit:canEdit};
}
function setup(options={}){
 const host=document.createElement('div');document.body.append(host);
 const requestFn=options.requestFn||vi.fn(async(dataset,presentation)=>response(dataset,presentation));
 const saveFn=options.saveFn||vi.fn();
 const panel=createArticleSectionDefaultsPanel({host,requestFn,saveFn});panels.push(panel);
 const get=id=>host.querySelector('[data-testid="'+id+'"]');
 const toggle=(key,value)=>{const el=get('article-section-default-'+key);el.checked=value;el.dispatchEvent(new Event('change'));};
 return {...panel,host,get,toggle,requestFn,saveFn};
}
beforeEach(()=>{document.body.replaceChildren();mocks.language.mockReturnValue('en');mocks.success.mockClear();mocks.warning.mockClear();});
afterEach(()=>{panels.splice(0).forEach(panel=>panel.destroy());});
describe('article section defaults',()=>{
 test('is absent for card/table and exposes only supported independent article sections',async()=>{
  const p=setup();await p.setContext('a','card');expect(p.element.hidden).toBe(true);expect(p.requestFn).not.toHaveBeenCalled();
  await p.setContext('a','article_view');expect(p.element.hidden).toBe(false);expect(p.host.querySelectorAll('input')).toHaveLength(5);
  expect([...p.host.querySelectorAll('input')].every(input=>input.checked)).toBe(true);
  p.get('article-section-defaults-presentation').value='image_first';p.get('article-section-defaults-presentation').dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(p.requestFn).toHaveBeenLastCalledWith('a','image_first'));
  expect(p.host.querySelectorAll('input')).toHaveLength(1);
  await p.setContext('a','table');expect(p.element.style.display).toBe('none');
 });
 test('keeps unsaved drafts separate across presentation and dataset changes',async()=>{
  const p=setup();await p.setContext('a','article_view');p.toggle('details',false);
  const select=p.get('article-section-defaults-presentation');
  select.value='image_first';select.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(p.get('article-section-default-details').disabled).toBe(false));
  expect(p.get('article-section-default-details').checked).toBe(true);p.toggle('details',false);
  await p.setContext('b','article_view');expect(p.get('article-section-default-details').checked).toBe(true);
  await p.setContext('a','article_view');expect(p.get('article-section-default-details').checked).toBe(false);
  select.value='classic';select.dispatchEvent(new Event('change'));
  expect(p.get('article-section-default-details').checked).toBe(false);expect(p.get('article-section-default-images').checked).toBe(true);
  expect(p.saveFn).not.toHaveBeenCalled();
 });
 test('saves only changed booleans and requires matching API readback before success',async()=>{
  let stored={};
  const requestFn=vi.fn(async(dataset,presentation)=>response(dataset,presentation,stored));
  const saveFn=vi.fn(async payload=>{stored={...stored,...payload.initial_open};return response(payload.dataset,payload.presentation_key,stored);});
  const p=setup({requestFn,saveFn});await p.setContext('a','article_view');p.toggle('details',false);
  p.get('article-section-defaults-save').click();
  await vi.waitFor(()=>expect(mocks.success).toHaveBeenCalledOnce());
  expect(saveFn).toHaveBeenCalledExactlyOnceWith({dataset:'a',presentation_key:'classic',initial_open:{details:false}});
  expect(requestFn).toHaveBeenCalledTimes(2);expect(p.get('article-section-defaults-save').disabled).toBe(true);
 });
 test('rejects mismatched readback and retains the dirty draft',async()=>{
  const p=setup({saveFn:vi.fn(async()=>response('a','classic',{details:false}))});
  await p.setContext('a','article_view');p.toggle('details',false);p.get('article-section-defaults-save').click();
  await vi.waitFor(()=>expect(mocks.warning).toHaveBeenCalledOnce());
  expect(mocks.success).not.toHaveBeenCalled();expect(p.get('article-section-default-details').checked).toBe(false);
  expect(p.get('article-section-defaults-save').disabled).toBe(false);
 });
 test('reset targets only the selected presentation and leaves another dirty context intact',async()=>{
  let reset=false;
  const requestFn=vi.fn(async(dataset,presentation)=>response(dataset,presentation,presentation==='image_first'&&!reset?{details:false}:{}));
  const saveFn=vi.fn(async payload=>{reset=true;return response(payload.dataset,payload.presentation_key);});
  const p=setup({requestFn,saveFn});await p.setContext('a','article_view');p.toggle('images',false);
  const select=p.get('article-section-defaults-presentation');select.value='image_first';select.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(p.get('article-section-defaults-reset').disabled).toBe(false));
  p.get('article-section-defaults-reset').click();await vi.waitFor(()=>expect(mocks.success).toHaveBeenCalledOnce());
  expect(saveFn).toHaveBeenCalledExactlyOnceWith({dataset:'a',presentation_key:'image_first',reset_to_defaults:true});
  expect(p.get('article-section-default-details').checked).toBe(true);
  select.value='classic';select.dispatchEvent(new Event('change'));expect(p.get('article-section-default-images').checked).toBe(false);
 });
 test('late load and save results never replace another dataset context',async()=>{
  let resolveA;const requestFn=vi.fn((dataset,presentation)=>dataset==='a'?new Promise(resolve=>{resolveA=resolve;}):Promise.resolve(response(dataset,presentation,{details:false})));
  const p=setup({requestFn});const pending=p.setContext('a','article_view');await p.setContext('b','article_view');
  resolveA(response('a'));await pending;expect(p.get('article-section-default-details').checked).toBe(false);
  await p.setContext('a','article_view');let finishSave;
  p.saveFn.mockImplementation(()=>new Promise(resolve=>{finishSave=resolve;}));
  requestFn.mockImplementation(async(dataset,presentation)=>response(dataset,presentation,{details:false}));
  p.toggle('details',false);p.get('article-section-defaults-save').click();
  await p.setContext('b','article_view');p.toggle('images',false);
  finishSave(response('a','classic',{details:false}));
  await vi.waitFor(()=>expect(requestFn).toHaveBeenLastCalledWith('a','classic'));
  expect(p.get('article-section-default-images').checked).toBe(false);expect(mocks.success).not.toHaveBeenCalled();
 });
 test.each([['fi','Artikkelin avauslohkot'],['en','Article collapsible blocks'],['ch','文章折叠区块'],['yue','文章開合區塊']])('language %s preserves the draft',async(language,title)=>{
  const p=setup();await p.setContext('a','article_view');p.toggle('details',false);
  mocks.language.mockReturnValue(language);document.documentElement.lang=language;
  await vi.waitFor(()=>expect(p.host.querySelector('legend').textContent).toBe(title));
  expect(p.get('article-section-default-details').checked).toBe(false);
 });
 test('read-only and malformed responses never enable mutations',async()=>{
  const p=setup({requestFn:vi.fn(async(dataset,presentation)=>response(dataset,presentation,{},false))});
  await p.setContext('a','article_view');expect(p.get('article-section-defaults-save').disabled).toBe(true);
  expect(p.get('article-section-defaults-reset').disabled).toBe(true);expect(p.get('article-section-default-details').disabled).toBe(true);
  const bad=setup({requestFn:vi.fn(async()=>response('wrong'))});await bad.setContext('a','article_view');
  expect(bad.get('article-section-defaults-reset').disabled).toBe(true);expect(bad.get('article-section-defaults-status').textContent).toContain('could not');
 });
 test('destroy disconnects language observation and ignores pending DOM work',async()=>{
  let resolve;const p=setup({requestFn:()=>new Promise(done=>{resolve=done;})});
  const pending=p.setContext('a','article_view');p.destroy();resolve(response());await pending;
  document.documentElement.lang='fi';await Promise.resolve();expect(p.host.children).toHaveLength(0);
 });
});
