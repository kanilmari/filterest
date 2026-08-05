// asset_tab_printer.js
// Builds the "Add Asset" create-record form inside a given container element.
// Bridges the user tools tab container with a form for submitting new asset records.
// Exists to provide a dedicated asset creation tab in the user tools panel.

/**
 * Rakentaa "Create" (tai "Add Asset") -näkymän annetun containerin sisään.
 * Voit korvata "Asset" haluamallasi luontikohteella.
 */
export async function generate_create_view(container) {
    try {
        container.replaceChildren(); // Tyhjennä vanha sisältö

        const heading = document.createElement('h2');
        heading.textContent = 'Add New Asset';
        container.appendChild(heading);

        const form = document.createElement('form');
        form.id = 'add_asset_form';

        // Nimi
        const labelName = document.createElement('label');
        labelName.textContent = 'Name of Asset';
        labelName.setAttribute('for', 'asset_name_input');
        form.appendChild(labelName);

        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.id = 'asset_name_input';
        inputName.name = 'asset_name';
        inputName.required = true;
        form.appendChild(inputName);

        // Kuvaus
        const labelDesc = document.createElement('label');
        labelDesc.textContent = 'Description';
        labelDesc.setAttribute('for', 'asset_desc_input');
        form.appendChild(labelDesc);

        const inputDesc = document.createElement('textarea');
        inputDesc.id = 'asset_desc_input';
        inputDesc.name = 'asset_desc';
        inputDesc.rows = 4;
        form.appendChild(inputDesc);

        // Submit
        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.textContent = 'Create';
        form.appendChild(submitButton);

        form.addEventListener('submit', async (evt) => {
            evt.preventDefault();

            // Esimerkki: tallennus backendille
            // ... toteuta tallennus

            inputName.value = '';
            inputDesc.value = '';
        });

        container.appendChild(form);
    } catch (error) {
        console.warn('Error in generate_create_view:', error);
    }
}
