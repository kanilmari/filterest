// checkbox_state_handler.js
// Manages parent/child checkbox state propagation inside the reusable vanilla tree.
// Bridges checkbox DOM events with derived child and ancestor checked/indeterminate states.
// Exists to keep tree checkbox rules centralized instead of duplicating them in each tree consumer.

export function handle_checkbox_change(event) {
    const checkbox = event.target;
    update_child_states(checkbox);
    update_parent_state(checkbox);
}

function update_child_states(parentCheckbox) {
    const parentNode = parentCheckbox.closest('.node');
    if (!parentNode) return;

    const childContainer = parentNode.querySelector(':scope > .children');
    if (!childContainer) return;

    const childCheckboxes = childContainer.querySelectorAll(':scope > .node input[type="checkbox"]');
    childCheckboxes.forEach((childCb) => {
        childCb.checked = parentCheckbox.checked;
        childCb.indeterminate = false;
        childCb.setAttribute('data-indeterminate', 'false');
        update_child_states(childCb);
    });
}

export function update_parent_state(childCheckbox) {
    const parentElement = childCheckbox.closest('.node')?.parentElement?.closest('.node');
    if (!parentElement) return;

    const parentCheckbox = parentElement.querySelector('input[type="checkbox"]');
    if (!parentCheckbox) return;

    const childCheckboxes = parentElement.querySelectorAll(
        ':scope > .children > .node:not(.hidden) input[type="checkbox"]',
    );
    let allChecked = true;
    let anyChecked = false;

    childCheckboxes.forEach(chk => {
        if (chk.checked) {
            anyChecked = true;
        } else {
            allChecked = false;
        }
    });

    if (allChecked) {
        parentCheckbox.indeterminate = false;
        parentCheckbox.checked = true;
        parentElement.setAttribute('data-folder-fully-selected', 'true');
    } else if (anyChecked) {
        parentCheckbox.indeterminate = true;
        parentCheckbox.checked = false;
        parentElement.removeAttribute('data-folder-fully-selected');
    } else {
        parentCheckbox.indeterminate = false;
        parentCheckbox.checked = false;
        parentElement.removeAttribute('data-folder-fully-selected');
    }

    parentCheckbox.setAttribute('data-indeterminate', parentCheckbox.indeterminate ? 'true' : 'false');
    update_parent_state(parentCheckbox);
}

export function collect_checkbox_states(container) {
    const checkboxStates = {};
    if (!container) return checkboxStates;
    const allCheckboxes = container.querySelectorAll('.node input[type="checkbox"]');
    allCheckboxes.forEach(checkbox => {
        const nodeId = checkbox.closest('.node').id;
        checkboxStates[nodeId] = {
            checked: checkbox.checked,
            indeterminate: checkbox.indeterminate
        };
    });
    return checkboxStates;
}

export function apply_checkbox_states(checkboxStates, container) {
    if (!container) return;
    const allCheckboxes = container.querySelectorAll('.node input[type="checkbox"]');
    allCheckboxes.forEach(checkbox => {
        const nodeId = checkbox.closest('.node').id;
        if (checkboxStates[nodeId]) {
            checkbox.checked = checkboxStates[nodeId].checked;
            checkbox.indeterminate = checkboxStates[nodeId].indeterminate;
            checkbox.setAttribute('data-indeterminate', checkbox.indeterminate ? 'true' : 'false');
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            checkbox.setAttribute('data-indeterminate', 'false');
        }
    });
}
