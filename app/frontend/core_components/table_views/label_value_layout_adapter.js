// label_value_layout_adapter.js
// Supplies Filterest's Automatic-layout policy to the portable field renderer.
// Connects all core layout callers to the experimental free-layout availability owner.
// Registers before callers execute, including KV rendering through card_row_presentation.

import { isExperimentalFreeLayoutAvailable } from './experimental_free_layout_card/experimental_free_layout_card_store.js';
import { registerAutomaticLabelValueLayoutAvailability } from '../../reusable_components/key_value_container/label_value_layout.js';

// Keep a live reader: importing this module must not snapshot the page environment.
registerAutomaticLabelValueLayoutAvailability(() => isExperimentalFreeLayoutAvailable());

export {
    applyLabelValueLayout,
    applySiteLabelValueLayoutSetting,
    normalizeLabelValueLayout,
    readSiteLabelValueLayout,
} from '../../reusable_components/key_value_container/label_value_layout.js';
