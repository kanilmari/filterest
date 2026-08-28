// table_column_resizer.js
// Orchestrates drag-to-resize column handles across all tables on the page.
// Bridges column_resize_handler.js attachment logic with DOMContentLoaded and per-table initialisation calls.
// Exists to separate resize orchestration from the resize-handle attachment detail in column_resize_handler.js.

/**
 * Adds resize handles to all <th> elements within the given table element.
 * @param {HTMLTableElement} tableElement - The table to add column resizers to.
 */
export function initColumnResizer(tableElement) {
    const table_headers = tableElement.querySelectorAll("th");
    table_headers.forEach(function (table_header) {
        let existing_resize_handle = table_header.querySelector(".resize-handle");
        if (!existing_resize_handle) {
            let resize_handle_element = document.createElement("div");
            resize_handle_element.classList.add("resize-handle");
            table_header.appendChild(resize_handle_element);
        }
    });

    const resize_handles = tableElement.querySelectorAll(".resize-handle");
    resize_handles.forEach(function (resize_handle_element) {
        resize_handle_element.addEventListener("mousedown", function (mousedown_event) {
            mousedown_event.preventDefault();
            let table_header_element = resize_handle_element.parentElement;
            let start_mouse_x_position = mousedown_event.pageX;
            let start_header_width = table_header_element.offsetWidth;

            function handle_mousemove(mousemove_event) {
                let offset_x = mousemove_event.pageX - start_mouse_x_position;
                let new_width = start_header_width + offset_x;
                if (new_width > 30) {
                    table_header_element.style.width = new_width + "px";
                }
            }
            function handle_mouseup() {
                document.removeEventListener("mousemove", handle_mousemove);
                document.removeEventListener("mouseup", handle_mouseup);
            }
            document.addEventListener("mousemove", handle_mousemove);
            document.addEventListener("mouseup", handle_mouseup);
        });
    });
}

/**
 * Initializes column resizers on all <table> elements currently in the DOM.
 */
export function initAllColumnResizers() {
    document.querySelectorAll("table").forEach(table => initColumnResizer(table));
}

// Auto-initialize on page load for backward compatibility with side-effect import
document.addEventListener("DOMContentLoaded", function () {
    initAllColumnResizers();
});
