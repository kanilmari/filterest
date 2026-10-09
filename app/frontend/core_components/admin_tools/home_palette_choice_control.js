// home_palette_choice_control.js
// Builds Home's spatial grid and familiar text-alignment buttons.
// Connects translated names and pressed state to the palette draft.
// Keeps arrow-key choices, focus and position independent of text alignment.
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';

/** Native buttons provide Enter/Space; a single tab stop provides arrow navigation. */
export function createHomePaletteChoiceControl({ id, label, choices, grid }, copy, onChange) {
    const element = document.createElement('fieldset');
    element.className = 'home-palette-choice';
    const legend = document.createElement('legend');
    const group = document.createElement('div');
    group.className = grid ? 'home-palette-position-grid' : 'home-palette-alignment';
    group.dataset.testid = `home-palette-${id}`;
    group.setAttribute('role', 'group');
    element.append(legend, group);
    const buttons = choices.map((choice, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.testid = `home-palette-${id}-${choice}`;
        if (grid) {
            const marker = document.createElement('span');
            marker.className = 'home-palette-position-marker';
            marker.setAttribute('aria-hidden', 'true');
            button.append(marker);
        } else {
            button.append(createMaskIconSpan(`/frontend/icons/general/home-align-${choice}-icon.svg`, 'home-palette-alignment-icon'));
        }
        button.addEventListener('click', () => choose(index));
        button.addEventListener('keydown', event => {
            const row = Math.floor(index / 3), column = index % 3;
            const targets = grid ? {
                ArrowLeft: column > 0 ? index - 1 : index,
                ArrowRight: column < 2 ? index + 1 : index,
                ArrowUp: row > 0 ? index - 3 : index,
                ArrowDown: row < 2 ? index + 3 : index,
            } : { ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(choices.length - 1, index + 1) };
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : targets[event.key];
            if (target === undefined) return;
            event.preventDefault();
            buttons[target].focus();
            choose(target);
        });
        group.append(button);
        return button;
    });
    function choose(index) { setValue(choices[index]); onChange(choices[index]); }
    function setValue(value) {
        buttons.forEach((button, index) => {
            const selected = choices[index] === value;
            button.setAttribute('aria-pressed', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
    }
    function setCopy(next) {
        legend.textContent = next[label];
        group.setAttribute('aria-label', next[label]);
        buttons.forEach((button, index) => {
            button.setAttribute('aria-label', next[choices[index]]);
            button.title = next[choices[index]];
        });
    }
    setCopy(copy);
    return { element, setValue, setCopy };
}
