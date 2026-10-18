// @vitest-environment jsdom
// filterbar_preferences_controller.test.js
// Exercises role-independent loading, explicit personal choices and live ordering.
// Connects API responses to the actual mounted-section ordering subscribers.
// Covers failed and slow saves without relying on network or a second settings store.
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn(), edit: false, generation: 0, sessionSubscribers: new Set() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.api }));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => mocks.edit }));
vi.mock('../pipeline/api_pipeline.js', () => ({ registerEndpointRoute: vi.fn() }));
vi.mock('../auth/session_generation_store.js', () => ({
    getSessionGeneration: () => mocks.generation, revalidateSessionIdentity: async () => mocks.generation,
    subscribeToSessionGeneration: callback => {
        mocks.sessionSubscribers.add(callback);
        return () => mocks.sessionSubscribers.delete(callback);
    },
}));
const shared = { section_order: ['style', 'views', 'filters'], section_collapsed: { filters: true }, allow_own_order: true };
let destroy = [];
let windowListeners;
beforeEach(() => {
    vi.resetModules(); localStorage.clear(); document.body.replaceChildren();
    vi.stubGlobal('BroadcastChannel', undefined);
    windowListeners = vi.spyOn(window, 'addEventListener');
    mocks.sessionSubscribers.clear();
    mocks.edit = false; mocks.generation = 0;
    mocks.api.mockReset().mockImplementation(async name => name === 'getFilterbarSectionLayout' ? shared
        : { user_id: 42, order_mode: 'shared', visibility_memory: 'shared', own_order_allowed: true });
});
afterEach(() => {
    destroy.forEach(fn => fn()); destroy = [];
    for (const [type, listener, options] of windowListeners.mock.calls) window.removeEventListener(type, listener, options);
    mocks.sessionSubscribers.clear();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function deferred() {
    let resolve, reject;
    const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
    return { promise, resolve, reject };
}

function broadcastChannel() {
    const channel = new EventTarget();
    channel.postMessage = vi.fn();
    vi.stubGlobal('BroadcastChannel', vi.fn(function BroadcastChannel() { return channel; }));
    return channel;
}

test.each(['guest', 'ordinary', 'admin'])('%s reads the same shared order, independently of save permission', async role => {
    if (role !== 'guest') localStorage.setItem('button_state', 'logout');
    mocks.edit = role === 'admin';
    const controller = await import('./filterbar_preferences_controller.js');
    await Promise.all([controller.loadFilterbarPreferences(), controller.loadFilterbarPreferences()]);
    expect(controller.getFilterbarPreferences().order.slice(0,3)).toEqual(shared.section_order);
    expect(mocks.api.mock.calls.filter(([name]) => name === 'getFilterbarSectionLayout')).toHaveLength(1);
    expect(mocks.api.mock.calls.some(([, options]) => options.method === 'PATCH')).toBe(false);
});

test('a successful edit reorders both already-mounted bars without saving collapse snapshots', async () => {
    mocks.edit = true;
    const { setupFilterbarSectionOrdering } = await import('./filterbar_section_order_handler.js');
    const controller = await import('./filterbar_preferences_controller.js');
    function mount() {
        const panel = document.createElement('div');
        for (const key of ['filters', 'style', 'views']) {
            const section = document.createElement('section'); section.dataset.filterbarSectionKey = key;
            panel.append(section);
        }
        document.body.append(panel);
        const ordering = setupFilterbarSectionOrdering(panel); destroy.push(ordering.destroy);
        return { panel, ready: ordering.ready };
    }
    const first = mount(); const second = mount(); await Promise.all([first.ready, second.ready]);
    mocks.api.mockResolvedValueOnce({ ...shared, section_order: ['views','style','filters'] });
    await controller.saveFilterbarOrder(['views','style','filters']);
    for (const {panel} of [first,second]) expect(panel.firstElementChild.dataset.filterbarSectionKey).toBe('views');
    expect(mocks.api).toHaveBeenLastCalledWith('saveFilterbarSectionLayout', {
        method:'POST', body_data:{section_order:['views','style','filters']},
    });
});

test('own order is an explicit account preference and a shared change keeps it', async () => {
    localStorage.setItem('button_state', 'logout');
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    mocks.api.mockResolvedValueOnce({ user_id:42, own_order_allowed:true, order_mode:'own', section_order:['views','style'] });
    await controller.savePersonalFilterbarPreference({ order_mode:'own' });
    expect(mocks.api).toHaveBeenLastCalledWith('userFilterbarPreference', { method:'PATCH',body_data:{order_mode:'own'} });
    mocks.api.mockResolvedValueOnce({ ...shared, section_order:['filters','style'] });
    await controller.saveSharedFilterbarLayout({ section_order:['filters','style'] });
    expect(controller.getFilterbarPreferences().order[0]).toBe('views');
    mocks.api.mockResolvedValueOnce({ own_order_allowed:false, order_mode:'own', section_order:['views'] });
    await controller.savePersonalFilterbarPreference({ visibility_memory:'shared' });
    expect(controller.getFilterbarPreferences().mode).toBe('shared');
});

test('a late read cannot overwrite a committed edit, and a failed save keeps the loaded order', async () => {
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    let resolveRead;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => {resolveRead=resolve;}));
    const stale = controller.loadFilterbarPreferences({refresh:true});
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
    mocks.api.mockResolvedValueOnce({ ...shared, section_order:['views','style'] });
    await controller.saveFilterbarOrder(['views','style']);
    resolveRead(shared); await stale;
    expect(controller.getFilterbarPreferences().order[0]).toBe('views');
    mocks.api.mockRejectedValueOnce(new Error('save refused'));
    await expect(controller.saveFilterbarOrder(['filters'])).rejects.toThrow('save refused');
    expect(controller.getFilterbarPreferences().order[0]).toBe('views');
});

test('personal load failure still permits the public shared order', async () => {
    localStorage.setItem('button_state','logout');
    mocks.api.mockImplementation(async name => {
        if (name === 'userFilterbarPreference') throw new Error('unavailable');
        return shared;
    });
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    expect(controller.getFilterbarPreferences().order[0]).toBe('style');
    expect(controller.getFilterbarPreferences().ownAllowed).toBe(false);
});

test.each(['broadcast', 'focus', 'caller'])('%s refreshes during a load coalesce once and update mounted bars', async source => {
    const channel = broadcastChannel();
    const oldRead = deferred(), freshRead = deferred();
    mocks.api.mockImplementationOnce(() => oldRead.promise).mockImplementationOnce(() => freshRead.promise);
    const controller = await import('./filterbar_preferences_controller.js');
    const { setupFilterbarSectionOrdering } = await import('./filterbar_section_order_handler.js');
    const initial = controller.loadFilterbarPreferences();
    const panels = Array.from({ length: 2 }, () => {
        const panel = document.createElement('div');
        for (const key of ['filters', 'style', 'views']) {
            const section = document.createElement('section'); section.dataset.filterbarSectionKey = key;
            panel.append(section);
        }
        document.body.append(panel);
        const ordering = setupFilterbarSectionOrdering(panel); destroy.push(ordering.destroy);
        return panel;
    });
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const refreshes = [];
    for (let index = 0; index < 3; index += 1) {
        if (source === 'broadcast') channel.dispatchEvent(new MessageEvent('message', { data: 'changed' }));
        else if (source === 'focus') window.dispatchEvent(new Event('focus'));
        else refreshes.push(controller.loadFilterbarPreferences({ refresh: true }));
    }
    expect(mocks.api).toHaveBeenCalledTimes(1);
    if (source === 'caller') expect(refreshes[1]).toBe(refreshes[0]);
    oldRead.resolve({ ...shared, section_order: ['filters', 'style', 'views'] });
    await initial;
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    for (const panel of panels) expect(panel.firstElementChild.dataset.filterbarSectionKey).toBe('filters');
    freshRead.resolve(shared);
    await Promise.all(refreshes);
    await vi.waitFor(() => {
        for (const panel of panels) expect(panel.firstElementChild.dataset.filterbarSectionKey).toBe('style');
    });
    for (const refresh of refreshes) expect((await refresh).order[0]).toBe('style');
    await controller.loadFilterbarPreferences();
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(channel.postMessage).not.toHaveBeenCalled();
});

test('a queued refresh runs once after a failed load and returns its fresh result', async () => {
    const oldRead = deferred();
    mocks.api.mockImplementationOnce(() => oldRead.promise);
    const controller = await import('./filterbar_preferences_controller.js');
    const initial = controller.loadFilterbarPreferences();
    const failure = expect(initial).rejects.toThrow('read failed');
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const refresh = controller.loadFilterbarPreferences({ refresh: true });
    expect(controller.loadFilterbarPreferences({ refresh: true })).toBe(refresh);
    oldRead.reject(new Error('read failed'));
    await failure;
    expect((await refresh).order[0]).toBe('style');
    await controller.loadFilterbarPreferences();
    expect(mocks.api).toHaveBeenCalledTimes(2);
});

test('a personal save preserves a fresh shared refresh while rejecting its stale personal response', async () => {
    localStorage.setItem('button_state', 'logout');
    mocks.api.mockResolvedValueOnce({ ...shared, section_order: ['filters', 'style', 'views'] });
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    const oldPersonal = controller.getFilterbarPreferences().personal;
    const savedPersonal = { ...oldPersonal, visibility_memory: 'dataset' };
    const sharedRead = deferred(), personalRead = deferred();
    mocks.api.mockImplementation((name, options) => options.method === 'PATCH' ? Promise.resolve(savedPersonal)
        : name === 'getFilterbarSectionLayout' ? sharedRead.promise : personalRead.promise);
    const refresh = controller.loadFilterbarPreferences({ refresh: true });
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    await controller.savePersonalFilterbarPreference({ visibility_memory: 'dataset' });
    sharedRead.resolve(shared); personalRead.resolve(oldPersonal);
    await refresh;
    expect(controller.getFilterbarPreferences().order[0]).toBe('style');
    expect(controller.getFilterbarPreferences().personal).toEqual(savedPersonal);
    expect(controller.getFilterbarPreferences().loaded).toBe(true);
});

test('a shared save rejects stale shared reads while keeping a fresh personal refresh', async () => {
    localStorage.setItem('button_state', 'logout');
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    const freshPersonal = { ...controller.getFilterbarPreferences().personal, visibility_memory: 'dataset' };
    const savedShared = { ...shared, section_order: ['views', 'style', 'filters'] };
    const sharedRead = deferred(), personalRead = deferred();
    mocks.api.mockImplementation((name, options) => options.method === 'POST' ? Promise.resolve(savedShared)
        : name === 'getFilterbarSectionLayout' ? sharedRead.promise : personalRead.promise);
    const refresh = controller.loadFilterbarPreferences({ refresh: true });
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    await controller.saveSharedFilterbarLayout({ section_order: savedShared.section_order });
    sharedRead.resolve(shared); personalRead.resolve(freshPersonal);
    await refresh;
    expect(controller.getFilterbarPreferences().shared.section_order.slice(0, 3)).toEqual(savedShared.section_order);
    expect(controller.getFilterbarPreferences().personal).toEqual(freshPersonal);
    expect(controller.getFilterbarPreferences().loaded).toBe(true);
});

test('a session change discards both old read values and its queued refresh without clearing a new load', async () => {
    localStorage.setItem('button_state', 'logout');
    const controller = await import('./filterbar_preferences_controller.js'); await controller.loadFilterbarPreferences();
    const sharedRead = deferred(), personalRead = deferred();
    mocks.api.mockImplementation(name => name === 'getFilterbarSectionLayout' ? sharedRead.promise : personalRead.promise);
    const oldLoad = controller.loadFilterbarPreferences({ refresh: true });
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    const queued = controller.loadFilterbarPreferences({ refresh: true });
    mocks.generation += 1;
    for (const callback of mocks.sessionSubscribers) callback();
    const resetState = controller.getFilterbarPreferences();
    expect(resetState.loaded).toBe(false);
    expect(resetState.personal).toEqual({ order_mode: 'shared', visibility_memory: 'shared', own_order_allowed: false });
    const currentSharedRead = deferred(), currentPersonalRead = deferred();
    mocks.api.mockImplementation(name => name === 'getFilterbarSectionLayout' ? currentSharedRead.promise : currentPersonalRead.promise);
    const currentLoad = controller.loadFilterbarPreferences();
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(6));
    sharedRead.resolve({ ...shared, section_order: ['filters', 'style', 'views'] });
    personalRead.resolve({ user_id: 42, order_mode: 'own', own_order_allowed: true });
    await Promise.all([oldLoad, queued]);
    expect(controller.getFilterbarPreferences()).toEqual(resetState);
    expect(controller.loadFilterbarPreferences()).toBe(currentLoad);
    const currentPersonal = { user_id: 73, order_mode: 'shared', visibility_memory: 'dataset', own_order_allowed: true };
    currentSharedRead.resolve(shared); currentPersonalRead.resolve(currentPersonal);
    await currentLoad;
    expect(controller.getFilterbarPreferences().personal).toEqual(currentPersonal);
    expect(controller.getFilterbarPreferences().loaded).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(6);
});
