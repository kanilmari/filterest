// dataset_appearance_renderer.js
// Projects resolved appearance onto one dataset surface without root writes.
// Connects UID-owned state with covers, card adapters and detached articles.
// Uses the existing visual values and lets explicit application themes choose them.
import { DATASET_APPEARANCE_PATHS_BY_PLACE, datasetAppearanceField } from '../../shared/dataset_appearance/validator.js';
import { appearanceScopeElements } from '../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceStyle, clearAppearanceProjections }
    from '../../reusable_components/appearance_projection_writer.js';
import { applyCardFieldPresentationSetting } from './card_view/card_field_presentation.js';
import { applyCardImagePresentationSetting } from './card_view/card_image_presentation.js';
import { applySiteLabelValueLayoutSetting } from '../../reusable_components/key_value_container/label_value_layout.js';

const coverNames = {
    oval_width: 'mask-oval-x', oval_height: 'mask-oval-y', oval_position_y: 'mask-position-y',
    center_opacity: 'mask-center-opacity', mid_opacity: 'mask-mid-opacity', edge_opacity: 'mask-edge-opacity',
    center_stop: 'mask-center-stop', mid_stop: 'mask-mid-stop', edge_stop: 'mask-edge-stop',
};
const variables = Object.fromEntries(DATASET_APPEARANCE_PATHS_BY_PLACE.tab_only
    .filter(path => !path.endsWith('oval_enabled')).map(path => {
        const [group, key] = path.split('.');
        const name = coverNames[key] || key.replaceAll('_', '-');
        const unit = key.includes('stop') || key.startsWith('oval_') ? '%'
            : key.includes('height') || key.includes('fade') || key === 'image_blur' ? 'px' : '';
        return [path, [`--dataset-cover-${group === 'shared' ? '' : group + '-'}${name}`, unit]];
    }));
Object.assign(variables, {
    'shared.card_image_width': ['--card_image_large_width', 'px'],
    'shared.card_description_lines': ['--card-description-lines', ''],
    'shared.filterbar_content_top_space': ['--filterbar-content-top-space', 'px'],
});

/** Paint before assembly and again after it so newly created adapters use current state. */
export function renderDatasetAppearance(surface, config) {
    for (const [path, [name, unit]] of Object.entries(variables)) {
        const [group, key] = path.split('.');
        const rule = datasetAppearanceField(path);
        const value = path === 'shared.filterbar_content_top_space'
            ? Math.min(rule.max, Math.max(rule.min, config[group][key])) : config[group][key];
        projectAppearanceStyle(surface, name, `${value}${unit}`);
    }
    for (const theme of ['light', 'dark']) {
        projectAppearanceStyle(surface, `--dataset-cover-${theme}-mask-image`, config[theme].oval_enabled ? 'initial' : 'none');
        projectAppearanceStyle(surface, `--dataset-background-${theme}-image-blur`, `${config[theme].image_blur}px`);
    }
    const shared = config.shared;
    // Keep the resolved source separate from attributes painted onto reused
    // card nodes, so releasing the scoped draft restores the saved projection.
    surface._datasetAppearanceAttributes = { cardShowAllFields: String(shared.card_show_all_fields),
        cardStyleVariant: shared.card_style_variant, cardDetailColumns: String(shared.card_detail_columns),
        cardImagePresentation: shared.card_image_presentation, labelValueLayout: shared.label_value_layout };
    projectAppearanceAttribute(surface, 'articleImageCaptionPosition', shared.article_image_caption_position);
    // Captions carry their nearest owner's mode themselves: an outer dataset's
    // selector must never win over a nested related dataset's below-mode choice.
    appearanceScopeElements(surface, '.row_article_inline_image_caption, .row_article_content')
        .forEach(element => { projectAppearanceAttribute(element, 'articleImageCaptionPosition', shared.article_image_caption_position); });
    applyCardFieldPresentationSetting(shared.card_show_all_fields, shared.card_style_variant, shared.card_detail_columns, surface);
    applySiteLabelValueLayoutSetting(shared.label_value_layout, surface);
    applyCardImagePresentationSetting(shared.card_image_presentation, surface);
}

/** Remove the private projection as well as its identity on lifecycle invalidation. */
export function clearDatasetAppearanceSurface(surface) {
    clearAppearanceProjections(surface);
    delete surface._datasetAppearanceAttributes;
    delete surface.dataset.datasetAppearanceResolved;
    delete surface.dataset.datasetAppearanceUid;
    delete surface.dataset.datasetAppearanceScope;
}
