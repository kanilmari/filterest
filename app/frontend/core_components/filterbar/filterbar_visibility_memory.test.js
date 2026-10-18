// @vitest-environment jsdom
// filterbar_visibility_memory.test.js
// Exercises actual-state handover, retained dataset keys and reduced motion.
// Connects visibility mode choices to runtime binding with deterministic animation frames.
// Guards the first visit and every source/target transition without a browser clock race.
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ callbacks: [], state: {
    loaded: true, personal: { visibility_memory:'shared' },
} }));
vi.mock('./filterbar_preferences_controller.js', () => ({
    getFilterbarPreferences: () => mocks.state,
    subscribeFilterbarPreferences: callback => { mocks.callbacks.push(callback); return () => {}; },
}));
vi.mock('../auth/session_generation_store.js', () => ({ subscribeToSessionGeneration: () => () => {} }));
vi.mock('./filterbar_engine/filterbar_visibility_handler.js', () => ({
    setStoredVisibility: (name, visible) => localStorage.setItem(`${name}_filterbar_visible`, String(visible)),
    getStoredVisibility: name => {
        const value = localStorage.getItem(`${name}_filterbar_visible`);
        return value === 'true' ? true : value === 'false' ? false : null;
    },
}));
let frames;
let reduced;
let controllers;
beforeEach(() => {
    vi.resetModules(); localStorage.clear(); document.body.replaceChildren();
    mocks.state = { loaded:true, personal:{visibility_memory:'shared'} }; mocks.callbacks=[];
    frames = new Map(); controllers=[]; reduced=false;
    let sequence=0;
    vi.stubGlobal('requestAnimationFrame', callback => { const id=++sequence; frames.set(id,callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
    window.matchMedia=vi.fn(() => ({matches:reduced}));
});
function flushFrame() {
    const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());
}
function bind(memory, tableName, initial) {
    let shown=initial;
    const container=document.createElement('div'); const panel=document.createElement('div'); container.append(panel); document.body.append(container);
    const controller=new AbortController(); controllers.push(controller);
    const applied=[];
    memory.bindFilterbarVisibilityMemory({ tableName, panel, host:container, container, visible:()=>shown,
        apply:visible=>{ shown=visible; applied.push({visible,instant:container.classList.contains('filterbar-visibility-instant')}); },
        isActive:()=>true, signal:controller.signal,
    });
    return { applied, shown:()=>shown, container };
}

test.each([[true,true],[true,false],[false,true],[false,false]])('per-dataset transition %s -> %s starts at the actual source and changes once', async (from,to) => {
    localStorage.setItem('filterbar_visibility_memory','dataset');
    const memory=await import('./filterbar_visibility_memory.js');
    const source=bind(memory,'first',from); flushFrame();
    localStorage.setItem('second_filterbar_visible',String(to));
    expect(memory.getInitialFilterbarMemory('second')).toBe(from);
    const target=bind(memory,'second',!from);
    expect(target.shown()).toBe(source.shown());
    flushFrame();
    expect(target.shown()).toBe(to);
    expect(target.applied.map(state=>state.visible)).toEqual(from===to?[from]:[from,to]);
    if (from!==to) expect(target.applied[1].instant).toBe(false);
    controllers.forEach(controller=>controller.abort());
});

test('shared is the default and seeds from the active bar, keeping old dataset memories', async () => {
    const memory=await import('./filterbar_visibility_memory.js');
    expect(memory.visibilityMemoryMode()).toBe('shared');
    bind(memory,'current',false); flushFrame();
    localStorage.setItem('next_filterbar_visible','true');
    const target=bind(memory,'next',true); flushFrame();
    expect(target.applied).toEqual([{visible:false,instant:true}]);
    expect(localStorage.getItem('next_filterbar_visible')).toBe('true');
    expect(localStorage.getItem('filterbar_shared_visible:guest')).toBe('false');
    controllers.forEach(controller=>controller.abort());
});

test('reduced motion commits a different dataset state without animation', async () => {
    localStorage.setItem('filterbar_visibility_memory','dataset'); reduced=true;
    const memory=await import('./filterbar_visibility_memory.js');
    bind(memory,'current',false); flushFrame(); localStorage.setItem('next_filterbar_visible','true');
    const target=bind(memory,'next',false); flushFrame();
    expect(target.applied).toEqual([{visible:false,instant:true},{visible:true,instant:true}]);
    controllers.forEach(controller=>controller.abort());
});

test('first visit has no fabricated stored choice; only the visited dataset legacy key is consulted', async () => {
    const memory=await import('./filterbar_visibility_memory.js');
    localStorage.setItem('unrelated_filterbar_visible','true');
    expect(memory.getInitialFilterbarMemory('new_dataset')).toBeNull();
    const {buildInitialResponsivePanelState}=await import('./filterbar_visibility_resolver.js');
    expect(buildInitialResponsivePanelState({storedVisibility:null,dbDefault:false,isNarrowScreen:false}).shouldShowPanel).toBe(false);
    expect(buildInitialResponsivePanelState({storedVisibility:false,dbDefault:true,isNarrowScreen:false}).shouldShowPanel).toBe(false);
});

test('choosing shared memory uses the bar currently in use, and account choices are separate', async () => {
    localStorage.setItem('filterbar_visibility_memory','dataset');
    localStorage.setItem('arbitrary_filterbar_visible','true');
    const memory=await import('./filterbar_visibility_memory.js');
    bind(memory,'current',false); flushFrame(); memory.setFilterbarVisibilityMemoryMode('shared');
    expect(localStorage.getItem('filterbar_shared_visible:guest')).toBe('false');
    localStorage.setItem('button_state','logout'); mocks.state.personal={user_id:42,visibility_memory:'dataset'};
    memory.rememberFilterbarVisibility('current',true);
    expect(localStorage.getItem('filterbar_shared_visible:guest')).toBe('false');
    controllers.forEach(controller=>controller.abort());
});
