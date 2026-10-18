// dataset_appearance_state.js
// Owns authorized appearance by immutable dataset UID, only in document memory.
// Connects results snapshots, public site previews and separately mounted surfaces.
// Guards lifecycle/revision races and never stores private appearance in browser storage.
import { DEFAULT_DATASET_APPEARANCE, DATASET_APPEARANCE_PATHS, DATASET_APPEARANCE_PATHS_BY_PLACE,
    isReadableDatasetAppearance } from '../../shared/dataset_appearance/validator.js';
import { readDatasetAppearance } from '../../shared/dataset_appearance/snapshot.js';
import { getAllSpecs, getTableSpecOwnershipVersion } from '../state_stores/table_specs_reader.js';
import { subscribeToSessionGeneration } from '../auth/session_generation_store.js';
import { setPublicAppearanceAttributes } from '../../reusable_components/appearance_scope_reader.js';
import { renderDatasetAppearance, refreshDatasetAppearanceAdapters,
    clearDatasetAppearanceSurface } from './dataset_appearance_renderer.js';

const clone = value => JSON.parse(JSON.stringify(value));
const leaf = (config, path) => { const [group, key] = path.split('.'); return config[group]?.[key]; };
const assignLeaf = (config, path, value) => { const [group, key] = path.split('.'); config[group][key] = value; };
const normalize = config => Object.fromEntries(Object.entries(DEFAULT_DATASET_APPEARANCE).map(([group, defaults]) => [
    group, Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, config?.[group]?.[key] ?? value])),
]));

/** Separate instances make ownership and races testable without booting a shell. */
export function createDatasetAppearanceState() {
    const entries = new Map(), names = new Map(), surfaces = new Map(), generations = new Map(), previews = new Map();
    const uidGenerations = new Map();
    const revokedSequences = new Map();
    const configurations = new Map(), pendingNames = new Set(), assemblyNames = new Set(), pendingAssembly = new Set();
    let paintScheduled = false;
    let surfaceOwners = new WeakMap();
    let epoch = 0, lifecycleVersion = 0, siteGeneration = 0, sequence = 0;
    let site = null;

    function resolveUID(name) {
        return String(getAllSpecs()[name]?.table_uid || '') || names.get(name) || '';
    }
    function effective(name) {
        return effectiveUID(resolveUID(name));
    }
    function publicSiteConfiguration(entry) {
        return site?.config && (!entry || site.preview || entry.siteGeneration < siteGeneration
            || entry.snapshot.shared_version === site.version) ? site.config : null;
    }
    function siteDefaultValue(entry, path) {
        const publicConfig = publicSiteConfiguration(entry);
        if (publicConfig) return leaf(publicConfig, path);
        const snapshot = entry?.snapshot;
        // V2 owns defaults separately. V1 effective values can supply a site
        // default only when no saved override would leak into a removed draft.
        if (snapshot?.schema_version === 2) return snapshot.defaults[path];
        return (snapshot?.shared && leaf(snapshot.shared, path))
            ?? (snapshot && !Object.hasOwn(snapshot.overrides, path) ? leaf(snapshot.effective, path) : undefined)
            ?? leaf(DEFAULT_DATASET_APPEARANCE, path);
    }
    function effectiveUID(uid) {
        const entry = entries.get(uid);
        const config = normalize(entry?.snapshot.effective || site?.config);
        if (!entry) return config;
        const snapshot = entry.snapshot;
        const publicConfig = publicSiteConfiguration(entry);
        // In v1 covers still inherit the site, including today's cover preview.
        // V2 cover ownership never follows site saves/previews.
        const inheritedPaths = snapshot.schema_version === 1 ? DATASET_APPEARANCE_PATHS
            : [...DATASET_APPEARANCE_PATHS_BY_PLACE.site_default, ...DATASET_APPEARANCE_PATHS_BY_PLACE.site_only];
        for (const path of inheritedPaths) {
            // The v1 cover palette previews its shared cover on the open
            // dataset even when a legacy cover path was stored. Releasing
            // it restores that authorized snapshot; v2 tab covers stay local.
            const previewCover = snapshot.schema_version === 1 && site?.preview
                && DATASET_APPEARANCE_PATHS_BY_PLACE.tab_only.includes(path);
            if (previewCover || !Object.hasOwn(snapshot.overrides, path)) {
                if (DATASET_APPEARANCE_PATHS_BY_PLACE.site_default.includes(path)) {
                    assignLeaf(config, path, siteDefaultValue(entry, path));
                } else if (publicConfig) assignLeaf(config, path, leaf(publicConfig, path));
            }
        }
        const preview = previews.get(uid);
        if (preview) {
            for (const [path, value] of Object.entries(preview.settings.tab_values)) assignLeaf(config, path, value);
            for (const path of DATASET_APPEARANCE_PATHS_BY_PLACE.site_default) {
                assignLeaf(config, path, Object.hasOwn(preview.settings.overrides, path)
                    ? preview.settings.overrides[path] : siteDefaultValue(entry, path));
            }
        }
        return config;
    }
    function configuration(uid) {
        if (!configurations.has(uid)) {
            const config = effectiveUID(uid);
            const entry = entries.get(uid), snapshot = entry?.snapshot;
            const overrides = previews.get(uid)?.settings.overrides || snapshot?.overrides || {};
            const path = 'shared.card_image_presentation';
            config.cardImageDefaults = {
                dataset: Object.hasOwn(overrides, path) ? overrides[path] : null,
                site: siteDefaultValue(entry, path),
            };
            configurations.set(uid, { config, signature: JSON.stringify([uid, entries.has(uid), config]) });
        }
        return configurations.get(uid);
    }
    function apply(ref, refreshAdapters = false) {
        const surface = ref.node.deref();
        if (!surface) {
            const refs = surfaces.get(ref.name);
            refs?.delete(ref);
            if (!refs?.size) surfaces.delete(ref.name);
            pendingAssembly.delete(ref);
            return;
        }
        if (surfaceOwners.get(surface) !== ref) return;
        // Unknown owners seal on first authorization; renamed/reused names cannot change that UID.
        const uid = ref.snapshotAllowed ? (ref.uid ||= resolveUID(ref.name)) : '';
        const { config, signature } = configuration(uid);
        if (ref.signature !== signature) {
            if (uid) surface.dataset.datasetAppearanceUid = uid;
            else delete surface.dataset.datasetAppearanceUid;
            surface.dataset.datasetAppearanceResolved = String(entries.has(uid));
            renderDatasetAppearance(surface, config);
            ref.signature = signature;
        } else if (refreshAdapters) {
            // An explicit end-of-assembly paint/rebind may have added descendants.
            // Refresh those adapters without rewriting the unchanged surface variables.
            refreshDatasetAppearanceAdapters(surface, config);
        }
    }
    function schedulePaint() {
        if (paintScheduled) return;
        paintScheduled = true;
        // Microtasks finish assembly before the browser's next paint. A frame callback
        // could leave newly mounted content unstyled until a later frame.
        queueMicrotask(() => {
            paintScheduled = false;
            const namesToPaint = [...pendingNames], adaptersToPaint = new Set(pendingAssembly);
            const assembledNames = new Set(assemblyNames);
            pendingNames.clear(); pendingAssembly.clear(); assemblyNames.clear();
            for (const name of namesToPaint) for (const ref of surfaces.get(name) || []) {
                const refresh = assembledNames.has(name) || adaptersToPaint.has(ref);
                adaptersToPaint.delete(ref);
                apply(ref, refresh);
            }
            for (const ref of adaptersToPaint) apply(ref, true);
        });
    }
    function queuePaint(name) {
        if (!surfaces.has(name)) return;
        pendingNames.add(name);
        schedulePaint();
    }
    /** Explicit paints also finish assembly of newly added descendants. */
    function paint(name) {
        if (!surfaces.has(name)) return;
        assemblyNames.add(name);
        queuePaint(name);
    }
    function paintUID(uid) {
        for (const [name, refs] of surfaces) {
            if ([...refs].some(ref => ref.uid === uid || (!ref.uid && resolveUID(name) === uid))) queuePaint(name);
        }
    }
    function capture(name) {
        const uid = resolveUID(name);
        return Object.freeze({ name, epoch, generation: generations.get(name) || 0,
            uid, uidGeneration: uidGenerations.get(uid) || 0,
            registryUID: String(getAllSpecs()[name]?.table_uid || ''),
            registryVersion: getTableSpecOwnershipVersion(name), siteGeneration, sequence: ++sequence });
    }
    function isCurrent(token) {
        if (token?.registry) return token.epoch === epoch && token.lifecycleVersion === lifecycleVersion
            && token.registryVersion === getTableSpecOwnershipVersion();
        if (!token) return true;
        const registryVersion = getTableSpecOwnershipVersion(token.name);
        const authorizedUID = token.uid || names.get(token.name);
        // The initial tree can finish while authorized results are assembling.
        // Its first discovery confirms that owner; it is not a replacement.
        // Require a saved authorized snapshot and exactly one registry change:
        // a different UID, deletion or replacement-and-restoration still cancels.
        const confirmsAuthorizedUID = !token.registryUID && entries.has(authorizedUID)
            && String(getAllSpecs()[token.name]?.table_uid || '') === authorizedUID
            && registryVersion === token.registryVersion + 1;
        return token.epoch === epoch && token.generation === (generations.get(token.name) || 0)
            && (token.registryVersion === registryVersion || confirmsAuthorizedUID)
            && token.uidGeneration === (uidGenerations.get(token.uid) || 0)
            && (!token.uid || !resolveUID(token.name) || token.uid === resolveUID(token.name));
    }
    /** Related-row responses may discover names absent from the registry at dispatch. */
    function captureRegistry() {
        return Object.freeze({ registry: true, epoch, lifecycleVersion,
            registryVersion: getTableSpecOwnershipVersion(), siteGeneration, sequence: ++sequence });
    }
    function accept(name, snapshot, { token, isCurrent: canCommit = () => true } = {}) {
        const resolved = readDatasetAppearance(snapshot);
        if (!isCurrent(token) || !canCommit() || !Number.isInteger(snapshot?.dataset_uid) || snapshot.dataset_uid < 1
            || !resolved) return false;
        const uid = String(snapshot.dataset_uid), knownUID = resolveUID(name);
        if (knownUID && knownUID !== uid) return false;
        // A denial clears appearance without cancelling readable related rows.
        // Its dispatch order still blocks older requests from restoring privacy.
        const revokedSequence = Math.max(revokedSequences.get(`name:${name}`) || 0,
            revokedSequences.get(`uid:${uid}`) || 0);
        if (token && token.sequence <= revokedSequence) return false;
        const previous = entries.get(uid);
        // Dataset revisions are monotonic integers (or the absent-row token).
        const revision = value => value === 'none' ? 0n : /^\d+$/.test(String(value)) ? BigInt(value) : null;
        const before = revision(previous?.snapshot.version), after = revision(snapshot.version);
        if (previous && before !== null && after !== null && after < before) return false;
        if (previous && before === after && token
            && (token.siteGeneration < previous.siteGeneration || token.sequence < previous.sequence)) return false;
        names.set(name, uid);
        entries.set(uid, { snapshot: clone({ ...snapshot, effective: resolved, overrides: snapshot.overrides || {} }),
            siteGeneration: token?.siteGeneration ?? siteGeneration,
            sequence: Math.max(previous?.sequence || 0, token?.sequence ?? ++sequence) });
        configurations.delete(uid);
        // A renamed dataset keeps its UID and every already mounted surface.
        paintUID(uid);
        return true;
    }
    function bind(surface, name, uid = null, { snapshotAllowed = true, related = false } = {}) {
        if (!surface || !name || name === 'home') return () => {};
        const ownerUID = snapshotAllowed ? String(uid || resolveUID(name)) : '';
        const refs = surfaces.get(name) || new Set();
        const existing = surfaceOwners.get(surface);
        if (existing?.uid && ownerUID && existing.uid !== ownerUID) return () => {};
        if (uid && snapshotAllowed) {
            if (resolveUID(name) && resolveUID(name) !== String(uid)) {
                lifecycleVersion += 1;
                generations.set(name, (generations.get(name) || 0) + 1);
            }
            names.set(name, String(uid));
        }
        if (existing) {
            existing.related ||= related;
            if (existing.snapshotAllowed !== snapshotAllowed) {
                clearDatasetAppearanceSurface(surface);
                surface.dataset.datasetAppearanceScope = existing.name;
                existing.snapshotAllowed = snapshotAllowed;
                existing.uid ||= ownerUID;
                existing.signature = null;
            }
            apply(existing);
            pendingAssembly.add(existing); schedulePaint();
            return existing.release;
        }
        surface.dataset.datasetAppearanceScope = name;
        const binding = { node: new WeakRef(surface), uid: ownerUID, name, snapshotAllowed, related };
        surfaceOwners.set(surface, binding);
        refs.add(binding);
        surfaces.set(name, refs);
        // Initial variables and source attributes are synchronous: card assembly reads
        // them immediately. Only this binding is applied, never its dataset siblings.
        apply(binding);
        pendingAssembly.add(binding); schedulePaint();
        binding.release = () => {
            // Keeping the disposer on the binding must not retain the DOM node.
            const boundSurface = binding.node.deref();
            if (boundSurface && surfaceOwners.get(boundSurface) !== binding) return;
            if (boundSurface) {
                surfaceOwners.delete(boundSurface);
                clearDatasetAppearanceSurface(boundSurface);
            }
            refs.delete(binding);
            pendingAssembly.delete(binding);
            if (!refs.size) { surfaces.delete(name); pendingNames.delete(name); assemblyNames.delete(name); }
        };
        return binding.release;
    }
    /** Palette drafts use the authorized result already in memory, without another GET. */
    function savedSnapshot(name) {
        const snapshot = entries.get(resolveUID(name))?.snapshot;
        return snapshot ? clone(snapshot) : null;
    }
    function setPreview(owner, name, settings) {
        if (!entries.has(resolveUID(name)) || !readDatasetAppearance(settings)
            || String(settings.dataset_uid) !== resolveUID(name)) return false;
        previews.set(resolveUID(name), { owner, name, settings: clone(settings) });
        configurations.delete(resolveUID(name));
        paintUID(resolveUID(name));
        return true;
    }
    function releasePreview(owner, name) {
        // Disposal belongs to the draft's original UID, even if its name was reused.
        const uid = [...previews].find(([, preview]) => preview.owner === owner && preview.name === name)?.[0]
            || resolveUID(name);
        if (previews.get(uid)?.owner !== owner) return false;
        previews.delete(uid);
        configurations.delete(uid);
        paintUID(uid);
        return true;
    }
    function ownsSurface(surface, uid) {
        const mountedUID = surface?.closest('[data-dataset-appearance-uid]')?.dataset.datasetAppearanceUid;
        return !mountedUID || !uid || mountedUID === String(uid);
    }
    function updateSite(config, { version = '', preview = false, changed = true } = {}) {
        if (!isReadableDatasetAppearance(config)) return;
        if (changed) siteGeneration += 1;
        site = { config: normalize(config), version, preview };
        configurations.clear();
        const shared = site.config.shared;
        setPublicAppearanceAttributes({ cardShowAllFields: String(shared.card_show_all_fields),
            cardStyleVariant: shared.card_style_variant, cardDetailColumns: String(shared.card_detail_columns),
            cardImagePresentation: shared.card_image_presentation, labelValueLayout: shared.label_value_layout });
        for (const name of surfaces.keys()) queuePaint(name);
        // Standalone adapters have no dataset identity (for example a Home block).
        // Update their projection without using document-wide dataset settings.
        document.querySelectorAll('.label-value-layout, .card, .card_photo_presentation').forEach(element => {
            if (element.closest('[data-dataset-appearance-scope]')) return;
            if (element.classList.contains('label-value-layout')) element.dataset.labelValueLayout = shared.label_value_layout;
            element._refreshFieldPresentation?.forEach(refresh => refresh());
            element._refreshImagePresentation?.();
        });
    }
    function clearBoundAppearance(name, uid, relatedOnly = false) {
        const affectedNames = new Set();
        for (const [candidate, refs] of surfaces) for (const ref of refs) {
            if (relatedOnly && !ref.related) continue;
            if (uid ? ref.uid !== uid && !(relatedOnly && candidate === name) : candidate !== name) continue;
            ref.snapshotAllowed = false;
            ref.signature = null;
            affectedNames.add(candidate);
            const surface = ref.node.deref();
            if (!surface) continue;
            // Round J's writer removes adapter writes before public repaint;
            // restore the boundary immediately so nested owners stay isolated.
            clearDatasetAppearanceSurface(surface);
            surface.dataset.datasetAppearanceScope = candidate;
        }
        for (const candidate of affectedNames) queuePaint(candidate);
    }
    /** Rejected refreshes demote related surfaces without discarding newer authorized results. */
    function rejectRelated(name, { token } = {}) {
        const uid = resolveUID(name);
        if (!isCurrent(token) || (token && (entries.get(uid)?.sequence || 0) > token.sequence)) return false;
        clearBoundAppearance(name, uid, true);
        return true;
    }
    /** Forget denied appearance page-wide, retaining row guards and public-only scopes. */
    function revoke(name, { token } = {}) {
        if (!isCurrent(token)) return false;
        const uid = resolveUID(name), denialSequence = token?.sequence ?? ++sequence;
        // An older omission cannot undo a later successful revalidation.
        if ((entries.get(uid)?.sequence || 0) > denialSequence) return false;
        for (const key of [`name:${name}`, ...(uid ? [`uid:${uid}`] : [])]) {
            revokedSequences.set(key, Math.max(revokedSequences.get(key) || 0, denialSequence));
        }
        entries.delete(uid); previews.delete(uid);
        configurations.delete(uid);
        clearBoundAppearance(name, uid);
        return true;
    }
    function forget(name) {
        lifecycleVersion += 1;
        const uid = resolveUID(name);
        if (uid) uidGenerations.set(uid, (uidGenerations.get(uid) || 0) + 1);
        generations.set(name, (generations.get(name) || 0) + 1);
        for (const [candidate, refs] of surfaces) {
            for (const ref of refs) {
                if (uid ? ref.uid !== uid : candidate !== name) continue;
                const surface = ref.node.deref();
                if (surface) { surfaceOwners.delete(surface); clearDatasetAppearanceSurface(surface); }
                refs.delete(ref);
                pendingAssembly.delete(ref);
            }
            if (!refs.size) { surfaces.delete(candidate); pendingNames.delete(candidate); assemblyNames.delete(candidate); }
        }
        for (const [candidate, candidateUID] of names) {
            if (candidateUID !== uid) continue;
            generations.set(candidate, (generations.get(candidate) || 0) + 1);
            names.delete(candidate);
        }
        entries.delete(uid);
        previews.delete(uid);
        configurations.delete(uid);
    }
    function clear() {
        epoch += 1;
        for (const refs of surfaces.values()) for (const ref of refs) {
            const surface = ref.node.deref();
            if (surface) clearDatasetAppearanceSurface(surface);
        }
        surfaces.clear();
        pendingNames.clear(); assemblyNames.clear(); pendingAssembly.clear(); configurations.clear();
        surfaceOwners = new WeakMap();
        entries.clear(); names.clear(); generations.clear(); uidGenerations.clear(); previews.clear();
        revokedSequences.clear();
    }
    return { capture, captureRegistry, isCurrent, accept, bind, paint, ownsSurface, effective, updateSite, revoke, rejectRelated, forget, clear,
        savedSnapshot, setPreview, releasePreview };
}

export const datasetAppearanceState = createDatasetAppearanceState();
// Focus/resume validation belongs to the session service; only identity changes
// destroy appearance. The logout shell also clears it when browser storage fails.
subscribeToSessionGeneration(reason => {
    if (!['blur', 'focus', 'suspend', 'resume', 'restore'].includes(reason)) datasetAppearanceState.clear();
});
