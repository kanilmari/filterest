// active_heading_updater.js
// Highlights the collapsible heading that matches the currently active navigation group.
// Bridges navigation group state and the .collapsible DOM elements in the sidebar.
// Exists to break the nav_builder → navigation_handler → nav_builder circular dependency.

/**
 * Korostaa oikean collapsible-otsikon aktiiviseksi ryhmänimen perusteella.
 */
export function update_active_heading(groupName) {
    const all_headings = document.querySelectorAll('.collapsible');
    all_headings.forEach(heading => heading.classList.remove('child-active'));

    const active_heading = document.querySelector(`.collapsible[data-group="${groupName}"]`);
    if (active_heading) {
        active_heading.classList.add('child-active');
    }
}
