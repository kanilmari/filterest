// related_dataset_appearance_revalidation.js
// Revalidates private appearance separately from readable related rows.
// Connects dispatch-guarded related responses with public-only panel/card bindings.
// Prevents omissions or rejected snapshots from recovering cached appearance.
import { datasetAppearanceState } from '../dataset_appearance_state.js';

/** Carry the acceptance decision with the response, never acquire a later request guard. */
export function revalidateRelatedDatasetAppearance(child, token) {
    let accepted = false;
    if (!child.dataset_appearance) datasetAppearanceState.revoke(child.dataset, { token });
    else {
        accepted = child.dataset_uid === child.dataset_appearance.dataset_uid
            && datasetAppearanceState.accept(child.dataset, child.dataset_appearance, { token });
        if (!accepted) datasetAppearanceState.rejectRelated(child.dataset, { token });
    }
    Object.defineProperties(child, {
        appearanceToken: { value: token, configurable: true },
        appearanceAccepted: { value: accepted, configurable: true },
    });
    return accepted;
}

/** A failed response binds only public defaults, even when another snapshot is cached. */
export function bindRelatedDatasetAppearance(surface, child, token = child.appearanceToken) {
    const accepted = child.appearanceAccepted === false ? false
        : revalidateRelatedDatasetAppearance(child, token);
    return datasetAppearanceState.bind(surface, child.dataset, child.dataset_uid || child.table_uid,
        { snapshotAllowed: accepted, related: true });
}
