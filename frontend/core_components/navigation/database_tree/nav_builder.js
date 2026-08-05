// nav_builder.js
// Constructs the navigation menu and updates active headings based on the current route.
// Bridges the permission checker and vanilla_tree renderer to build the collapsible sidebar nav.
// Exists to centralise nav DOM assembly so route changes and permission state flow through one build function.

import { hasRoutePermission } from '../../route_permission_checker.js';
import { handle_all_navigation } from '../nav_engine/navigation_handler.js';
import { render_tree } from '../../../reusable_components/vanilla_tree/vanilla_tree_builder.js';
import { createAnimatedDisclosureSection } from '../../../reusable_components/animated_disclosure/animated_disclosure_builder.js';
import { groupViewsByGroup, appendMissingAdminViews, getAdminToolsStructure } from './nav_builder_helpers.js';

const NAV_GROUP_ICONS = {
    admin_tools: '/frontend/icons/general/table-tools-icon.svg',
    user_tools: '/frontend/icons/general/user-person-icon.svg',
    dev_tools: '/frontend/icons/general/table-tools-icon.svg',
};

/**
 * Luo navigaation collapsible-otsikot ja niihin napit.
 */
export async function create_navigation_buttons(custom_views) {
    const nav_container = document.getElementById('navContainer');
    if (!nav_container) return;
    nav_container.replaceChildren();

    const canViewAdminGroups = hasRoutePermission('/ui/nav_container');

    const custom_views_by_group = groupViewsByGroup(custom_views);

    // Luodaan collapsible-painike kullekin ryhmälle
    for (const [group_name, views] of Object.entries(custom_views_by_group)) {
        if (!canViewAdminGroups && (group_name === 'admin_tools' || group_name === 'user_tools')) {
            continue;
        }

        // Ryhmän sisältödivi
        const content_div = document.createElement('div');
        content_div.className = 'navbar-disclosure-content';
        content_div.dataset.group = group_name;
        const section = buildNavigationDisclosureGroup(group_name, content_div);
        nav_container.appendChild(section);

        if (group_name === 'admin_tools') {
            const treeData = buildAdminToolsTree(views);
            const treeContainer = document.createElement('div');
            treeContainer.id = 'admin_tools_tree';
            content_div.appendChild(treeContainer);

            await render_tree(treeData, {
                container_id: 'admin_tools_tree',
                id_suffix: '_admin',
                render_mode: 'button',
                tree_model: 'nested',
                button_action_function: (nodeData) => {
                    handle_all_navigation(nodeData.id, custom_views);
                },
                show_node_count: false,
                show_search: false,
                use_icons: false,
                initial_open_level: 1
            });
        } else {
            // Luodaan jokaiselle view:lle varsinainen nappi
            views.forEach(view => {
                const button = document.createElement('button');
                button.classList.add('navigation_buttons', 'general_button_nav');
                button.type = 'button';
                button.textContent = view.name;
                button.dataset.testid = `nav-view-${view.name}`;
                button.dataset.langKey = view.name;
                // Tallennetaan ryhmä, jotta voidaan myöhemmin merkitä collapsible-otsikko
                button.dataset.group = group_name;

                button.addEventListener('click', async function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    await handle_all_navigation(view.name, custom_views);
                });

                content_div.appendChild(button);
            });
        }
    }
}

function buildNavigationDisclosureGroup(groupName, contentElement) {
    const section = createAnimatedDisclosureSection({
        titleLangKey: groupName,
        titleText: groupName,
        iconPath: NAV_GROUP_ICONS[groupName] || NAV_GROUP_ICONS.admin_tools,
        contentElement,
        startOpen: false,
        sectionClassNames: [
            'navbar-disclosure-section',
            `navbar-disclosure-section--${groupName}`,
        ],
        headerClassNames: [
            'navbar-section-heading',
            'collapsible',
        ],
        observeResize: false,
    });

    const header = section.querySelector(':scope > .navbar-section-heading');
    if (header instanceof HTMLElement) {
        header.dataset.group = groupName;
        header.dataset.testid = `nav-group-${groupName}`;
    }
    section.dataset.group = groupName;
    return section;
}

function buildAdminToolsTree(views) {
    const viewNames = new Set(views.map(v => v.name));

    const structure = getAdminToolsStructure();

    appendMissingAdminViews(structure, views);

    // Recursive function to filter and map
    // is_leaf: true merkitään solmuihin joilla ei ole lapsia, jotta
    // render_tree_node erottaa ne kansioista (muuten kaikki admin-solmut
    // tulkitaan kansioiksi koska niiltä puuttuu table_uid).
    // Per-view permission check: leaf nodes are only shown if the user has
    // the specific /ui/admin/... permission for that view (or if the view
    // has no requiredPermission defined).
    function filterTree(nodes) {
        return nodes.map(node => {
            if (node.children) {
                const filteredChildren = filterTree(node.children);
                if (filteredChildren.length > 0) {
                    return { ...node, children: filteredChildren, db_id: node.id };
                }
                return null;
            } else {
                if (!viewNames.has(node.id)) return null;
                // Check per-view permission from custom_views registry
                const viewDef = views.find(v => v.name === node.id);
                if (viewDef && viewDef.requiredPermission && !hasRoutePermission(viewDef.requiredPermission)) {
                    return null;
                }
                return { ...node, db_id: node.id, is_leaf: true };
            }
        }).filter(n => n !== null);
    }

    return filterTree(structure);
}
