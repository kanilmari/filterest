// json_column_checker.js
// Renders the admin tool for detecting JSON-like content in TEXT columns.
// Bridges the backend scan endpoint with the admin tool container and button workflow.
// Exists to help admins identify columns that should potentially be migrated to JSON types.

import { endpoint_router } from '../endpoints/endpoint_router.js';

export function generate_check_json_columns_view(container) {
    if (!container) return;

    const button = document.createElement('button');
    button.textContent = 'Check for JSON in Text Columns';
    button.className = 'button';
    button.onclick = async () => {
        button.disabled = true;
        button.textContent = 'Checking...';
        try {
            const response = await endpoint_router('checkJsonColumns');
            if (response && response.warnings) {
                displayWarnings(response.warnings, resultsDiv);
            } else {
                displayWarnings([], resultsDiv);
            }
        } catch (error) {
            console.warn('Error checking JSON columns:', error);
            displayWarnings(['Error checking columns. See console for details.'], resultsDiv);
        } finally {
            button.disabled = false;
            button.textContent = 'Check for JSON in Text Columns';
        }
    };

    container.appendChild(button);
    
    const resultsDiv = document.createElement('div');
    resultsDiv.style.marginTop = '10px';
    container.appendChild(resultsDiv);
}

function displayWarnings(warnings, resultsDiv) {
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '';

    if (warnings.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No issues found. All text columns seem clean.';
        p.style.color = 'green';
        resultsDiv.appendChild(p);
        return;
    }

    const ul = document.createElement('ul');
    warnings.forEach(warning => {
        const li = document.createElement('li');
        li.textContent = warning;
        li.style.color = 'orange';
        ul.appendChild(li);
    });
    resultsDiv.appendChild(ul);
}
