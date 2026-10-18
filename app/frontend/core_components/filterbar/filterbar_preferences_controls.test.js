// @vitest-environment jsdom
// filterbar_preferences_controls.test.js
// Exercises translated, explained choices and accessible ordering controls.
// Connects the settings surface to the existing preference APIs without JSON inputs.
// Guards ordinary-user policy and explicit copying with Finnish and English copy.
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    language:'fi', savePersonal:vi.fn(async()=>{}), saveOrder:vi.fn(async()=>{}),
    state: { loaded:true, shared:{allow_own_order:true}, mode:'shared', ownAllowed:true,
        canEditShared:false, order:['filters','style','chat'] },
}));
vi.mock('./filterbar_preferences_controller.js', () => ({
    getFilterbarPreferences:()=>mocks.state,
    loadFilterbarPreferences:async()=>mocks.state,
    subscribeFilterbarPreferences:()=>()=>{},
    savePersonalFilterbarPreference:mocks.savePersonal,
    saveFilterbarOrder:mocks.saveOrder, saveSharedFilterbarLayout:vi.fn(),
}));
vi.mock('./filterbar_visibility_memory.js', () => ({visibilityMemoryMode:()=> 'shared',setFilterbarVisibilityMemoryMode:vi.fn()}));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey:key=> {
    const fi={filterbar_preferences:'Suodatinpalkin asetukset',filterbar_order_shared:'Yhteinen järjestys',filterbar_order_own:'Oma järjestys',
        filterbar_visibility_shared:'Yhteinen kaikille aineistoille',filterbar_visibility_dataset:'Muista aineistoittain'};
    const en={filterbar_preferences:'Filter bar settings',filterbar_order_shared:'Shared order',filterbar_order_own:'Own order',
        filterbar_visibility_shared:'Shared for all datasets',filterbar_visibility_dataset:'Remember per dataset'};
    return (mocks.language==='fi'?fi:en)[key] || `${mocks.language}: ${key}`;
} }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({showErrorToast:vi.fn()}));
import { buildFilterbarPreferenceControls } from './filterbar_preferences_controls.js';
beforeEach(()=>{localStorage.clear();document.body.replaceChildren();vi.clearAllMocks();mocks.state.mode='shared';mocks.state.ownAllowed=true;mocks.state.canEditShared=false;});

test.each(['fi','en'])('%s settings explain choices and contain no raw configuration input',async language=>{
    mocks.language=language; localStorage.setItem('button_state','logout');
    const root=buildFilterbarPreferenceControls(); document.body.append(root);
    expect(root.textContent).toContain(language==='fi'?'Suodatinpalkin asetukset':'Filter bar settings');
    expect(root.textContent).toContain(language==='fi'?'Muista aineistoittain':'Remember per dataset');
    expect(root.querySelectorAll('p')).toHaveLength(2);
    expect(root.querySelector('textarea')).toBeNull();
    expect(mocks.savePersonal).not.toHaveBeenCalled();
    const select=root.querySelector('[data-testid="filterbar_order_title"]');
    select.value='own'; select.dispatchEvent(new Event('change'));
    await vi.waitFor(()=>expect(mocks.savePersonal).toHaveBeenCalledWith({order_mode:'own'}));
    root.destroy();
});

test('an ordinary reader cannot choose own order when the site disallows it',()=>{
    localStorage.setItem('button_state','logout');mocks.state.ownAllowed=false;
    const root=buildFilterbarPreferenceControls();
    expect(root.querySelector('option[value="own"]').disabled).toBe(true);
    expect(root.querySelector('[data-testid="filterbar-order-list"]')).toBeNull();root.destroy();
});

test('own ordering uses buttons on phones and leaves the conversation pinned',async()=>{
    localStorage.setItem('button_state','logout');mocks.state.mode='own';
    const root=buildFilterbarPreferenceControls();document.body.append(root);
    const rows=root.querySelectorAll('li'); expect(rows).toHaveLength(2);
    rows[0].querySelectorAll('button')[1].click();
    await vi.waitFor(()=>expect(mocks.saveOrder).toHaveBeenCalledWith(['style','filters','chat']));
    root.destroy();
});
