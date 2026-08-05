// service_catalog_moderation_view.js
// Renders the admin workspace entrypoint for service-catalog moderation.
// Bridges preset moderation queues and the normal dataset view so admins can
// review, filter, and batch-work catalog rows without hidden-only logic.

import { performNavigation } from '../navigation/nav_engine/navigation_handler.js';
import { updateURL } from '../navigation/nav_engine/query_params.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';

const SERVICE_CATALOG_DATASET = 'app_service_catalog';

const MODERATION_PRESETS = Object.freeze([
    {
        id: 'service_catalog_moderation_all',
        title: 'Open moderation workspace',
        description: 'Open the full service catalog with moderation-aware filters, sorting, and batch selection.',
        params: {
            sort_column: 'updated',
            sort_order: 'DESC',
        },
    },
    {
        id: 'service_catalog_moderation_review_queue',
        title: 'Needs review',
        description: 'Show entries that still have not been reviewed by an admin.',
        params: {
            admin_reviewed: 'false',
            sort_column: 'updated',
            sort_order: 'DESC',
        },
    },
    {
        id: 'service_catalog_moderation_pending_approval',
        title: 'Pending approval',
        description: 'Show entries that are reviewed but not yet approved.',
        params: {
            admin_reviewed: 'true',
            admin_approved: 'false',
            sort_column: 'updated',
            sort_order: 'DESC',
        },
    },
    {
        id: 'service_catalog_moderation_unpublished',
        title: 'Unpublished entries',
        description: 'Show entries hidden from the public because published is false.',
        params: {
            published: 'false',
            sort_column: 'updated',
            sort_order: 'DESC',
        },
    },
    {
        id: 'service_catalog_moderation_disabled',
        title: 'Disabled entries',
        description: 'Show entries hidden from the public because enabled is false.',
        params: {
            enabled: 'false',
            sort_column: 'updated',
            sort_order: 'DESC',
        },
    },
]);

async function openModerationPreset(params = {}) {
    updateURL(SERVICE_CATALOG_DATASET, params);
    await performNavigation(
        SERVICE_CATALOG_DATASET,
        `${SERVICE_CATALOG_DATASET}_container`,
        () => refreshTableUnified(SERVICE_CATALOG_DATASET),
        null,
        false
    );
}

export async function generate_service_catalog_moderation_view(container) {
    if (!container) {
        return;
    }

    container.replaceChildren();

    const root = document.createElement('div');
    root.classList.add('fw-container', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const introCard = document.createElement('section');
    introCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-2');

    const title = document.createElement('h2');
    title.textContent = 'Service Catalog Moderation';
    introCard.appendChild(title);

    const introText = document.createElement('p');
    introText.classList.add('fw-text-muted');
    introText.textContent = 'Use these presets to jump into the service catalog dataset with moderation-focused filters. The normal dataset view remains the source of truth for listing, filtering, big-card review, and batch selection.';
    introCard.appendChild(introText);

    const policyList = document.createElement('ul');
    policyList.classList.add('fw-text-sm');
    [
        'Admins can review and edit moderation fields directly.',
        'Owners can self-manage published and enabled on their own rows.',
        'Other users and guests do not see moderation fields, but backend visibility still respects them.',
    ].forEach((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        policyList.appendChild(item);
    });
    introCard.appendChild(policyList);
    root.appendChild(introCard);

    const presetGrid = document.createElement('section');
    presetGrid.classList.add('fw-grid', 'fw-grid-2', 'fw-gap-4');

    MODERATION_PRESETS.forEach((preset) => {
        const card = document.createElement('article');
        card.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-3');

        const heading = document.createElement('h3');
        heading.textContent = preset.title;
        card.appendChild(heading);

        const description = document.createElement('p');
        description.classList.add('fw-text-muted', 'fw-text-sm');
        description.textContent = preset.description;
        card.appendChild(description);

        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('fw-btn', 'fw-btn--primary');
        button.dataset.testid = preset.id;
        button.textContent = preset.title;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await openModerationPreset(preset.params);
            } finally {
                button.disabled = false;
            }
        });
        card.appendChild(button);

        presetGrid.appendChild(card);
    });

    root.appendChild(presetGrid);
    container.appendChild(root);
}
