// disclosure_state_controller.js
// Resolves personal tab choices above the existing UID-owned appearance defaults.
// Connects deliberate disclosure activation, verified identity and appearance lifetimes.
// Never sends setting writes or broadcasts ordinary opening/closing to other tabs.
import definition from '../../shared/dataset_appearance/definition.json';
import { appearanceScopeElements } from '../../reusable_components/appearance_scope_reader.js';
import { getSessionGeneration, getVerifiedSessionIdentity, revalidateSessionIdentity,
    subscribeToSessionGeneration } from '../auth/session_generation_store.js';
import { readDisclosureChoice, rememberDisclosureChoice, clearDisclosureChoices }
    from '../state_stores/disclosure_choice_store.js';

const SELECTOR = '[data-article-disclosure-key], [data-filterbar-section-key]';
const SCOPE = '[data-dataset-appearance-scope]';
const active = new Set(); // Weak references do not retain detached article trees.
const bindings = new WeakMap();
// A new document is not an account change. Bootstrap still re-verifies identity
// before reading tab memory; the choice store discards a different viewer's state.
const retainedChoiceReasons = new Set(['bootstrap', 'blur', 'focus', 'suspend', 'resume', 'restore']);

export function disclosureSettingKey(surface, block) {
    const key = `${surface}_${block}_initial_open`;
    const field = definition.shared_fields[key];
    return field?.type === 'boolean' && field.place === 'site_default' ? key : null;
}

function context(binding, section, viewerID) {
    const datasetUID = binding.root.dataset.datasetAppearanceUid;
    const block = section.dataset.articleDisclosureKey || section.dataset.filterbarSectionKey;
    const key = disclosureSettingKey(binding.surface, block);
    if (!key || !/^[1-9][0-9]*$/.test(datasetUID || '')
        || section.closest(SCOPE) !== binding.root || !viewerID) return null;
    return { viewerID, datasetUID, surface: binding.surface, block, key };
}

function project(binding, viewerID) {
    if (binding.disposed) return;
    binding.viewerID = viewerID;
    for (const section of appearanceScopeElements(binding.root, SELECTOR)) {
        const choiceContext = context(binding, section, viewerID);
        if (!choiceContext || typeof section.expand !== 'function' || typeof section.collapse !== 'function'
            || section.dataset.filterbarTemporaryDisclosureOperation === 'true') continue;
        const choice = readDisclosureChoice(choiceContext);
        const fallback = binding.config?.shared?.[choiceContext.key]
            ?? definition.shared_fields[choiceContext.key].default;
        const expanded = choice ?? fallback;
        const signature = JSON.stringify([choiceContext.datasetUID, viewerID, choice, fallback]);
        // A refresh/reorder must not undo a temporary programmatic reveal.
        if (binding.painted.get(section) === signature) continue;
        binding.painted.set(section, signature);
        // A real header activation already started its animation. Recording its
        // choice must not issue a second, non-animated operation on that same block.
        if (section.dataset.disclosureState !== (expanded ? 'expanded' : 'collapsed')) {
            void (expanded ? section.expand({ animate: false }) : section.collapse({ animate: false }));
        }
    }
}

function refresh(binding) {
    const generation = getSessionGeneration();
    const viewerID = getVerifiedSessionIdentity();
    if (viewerID !== null) {
        project(binding, viewerID);
        binding.root.__disclosureStateReady = Promise.resolve();
        return;
    }
    binding.root.__disclosureStateReady = revalidateSessionIdentity({ requireIdentity: true })
        .then(() => {
            if (!binding.disposed && generation === getSessionGeneration()) {
                project(binding, getVerifiedSessionIdentity());
            }
        }).catch(() => { /* Unverified identity must not read another viewer's memory. */ });
}

function rememberActivation(binding, event) {
    const section = event.target;
    if (!(section instanceof HTMLElement) || event.detail?.section !== section
        || typeof event.detail.expanded !== 'boolean'
        || section.dataset.filterbarTemporaryDisclosureOperation === 'true') return;
    const expanded = event.detail.expanded;
    const generation = getSessionGeneration();
    const uid = binding.root.dataset.datasetAppearanceUid;
    const precedingViewer = binding.viewerID;
    const save = () => {
        const viewerID = getVerifiedSessionIdentity();
        if (binding.disposed || generation !== getSessionGeneration()
            || binding.root.dataset.datasetAppearanceUid !== uid
            || (precedingViewer !== null && precedingViewer !== viewerID)) return;
        const choiceContext = context(binding, section, viewerID);
        if (choiceContext && rememberDisclosureChoice(choiceContext, expanded)) {
            project(binding, viewerID);
        }
    };
    if (getVerifiedSessionIdentity() !== null) save();
    else void revalidateSessionIdentity({ requireIdentity: true }).then(save).catch(() => {});
}

/** Bind before appearanceState.bind, which supplies the resolved defaults and UID. */
export function bindDisclosureSurface(root, surface) {
    disposeDisclosureSurface(root);
    root.dataset.disclosureSurface = surface;
    const abort = new AbortController();
    const binding = { root, surface, config: null, viewerID: null, disposed: false,
        painted: new WeakMap(), abort, observer: null, ref: null };
    binding.ref = new WeakRef(root);
    active.add(binding.ref);
    bindings.set(root, binding);
    root.__syncDisclosureState = config => { binding.config = config; refresh(binding); };
    // Permission demotion clears the private projection, but the same surface
    // can become authorized again without being rebuilt. Keep its listener alive.
    root.__resetDisclosureState = () => {
        binding.config = null; binding.viewerID = null; binding.painted = new WeakMap();
        for (const section of appearanceScopeElements(root, SELECTOR)) {
            void section.collapse?.({ animate: false });
        }
    };
    root.__destroyDisclosureState = () => disposeDisclosureSurface(root);
    root.addEventListener('animated-disclosure-user-toggle', event => rememberActivation(binding, event),
        { signal: abort.signal });
    binding.observer = new MutationObserver(records => {
        const addedSection = records.some(record => [...record.addedNodes].some(node =>
            node instanceof HTMLElement && (node.matches(SELECTOR) || node.querySelector(SELECTOR))));
        if (addedSection) refresh(binding);
    });
    binding.observer.observe(root, { childList: true, subtree: true });
    root.__disclosureStateReady = Promise.resolve();
    return () => disposeDisclosureSurface(root);
}

export function disposeDisclosureSurface(root) {
    const binding = bindings.get(root);
    if (!binding) return;
    binding.disposed = true;
    binding.abort.abort();
    binding.observer.disconnect();
    active.delete(binding.ref);
    bindings.delete(root);
    delete root.__syncDisclosureState;
    delete root.__resetDisclosureState;
    delete root.__destroyDisclosureState;
    delete root.__disclosureStateReady;
}

subscribeToSessionGeneration(reason => {
    if (!retainedChoiceReasons.has(reason)) clearDisclosureChoices();
    if (reason === 'blur' || reason === 'suspend') return;
    for (const ref of active) {
        const root = ref.deref();
        if (!root) { active.delete(ref); continue; }
        const binding = bindings.get(root);
        if (!binding) { active.delete(ref); continue; }
        if (root.isConnected) refresh(binding);
    }
});
