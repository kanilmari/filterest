// vanilla_dropdown_builder.js
// Builds the reusable vanilla dropdown component used across the frontend.
// Bridges option data, search/filter behavior, and selection callbacks into one dropdown widget.
// Exists to provide a framework-free dropdown abstraction shared by multiple feature areas.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';

function sanitizeTestIdPart(value) {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return normalized || 'empty';
}

function buildDerivedTestId(baseTestId, suffix) {
	return baseTestId ? `${baseTestId}-${suffix}` : '';
}

function getDropdownTestIdBase(containerElement) {
	const explicitTestId = containerElement.dataset.testid?.trim() || '';
	if (explicitTestId) {
		return explicitTestId;
	}

	return containerElement.id?.trim() || '';
}

function attachStableOptionTestIds(options, baseTestId) {
	if (!Array.isArray(options) || options.length === 0) {
		return [];
	}

	if (!baseTestId) {
		return options;
	}

	const seenSanitizedValues = new Map();

	return options.map((option) => {
		const sanitizedValue = sanitizeTestIdPart(option.value);
		const seenCount = (seenSanitizedValues.get(sanitizedValue) || 0) + 1;
		seenSanitizedValues.set(sanitizedValue, seenCount);

		const optionSuffix =
			seenCount === 1 ? sanitizedValue : `${sanitizedValue}-${seenCount}`;

		return {
			...option,
			__dropdownOptionTestId: buildDerivedTestId(
				baseTestId,
				`option-${optionSuffix}`
			),
		};
	});
}

function resolveDropdownOptionLabel(option, translate) {
	if (!option) return "";
	const translated = option.langKey ? translate(option.langKey) : "";
	if (typeof translated === "string" && translated.trim()) {
		return translated;
	}
	return option.label || "";
}

/**
 * Pieni, hakutoiminnolla varustettu vanilla-dropdown-komponentti.
 *
 * @param {Object} config
 * @param {HTMLElement} config.containerElement - HTML-elementti, johon dropdown sijoitetaan
 * @param {Array<Object>} config.options - Alkuperäiset valintavaihtoehdot [{ value, label, ... }]
 * @param {string} [config.placeholder="Valitse..."] - Vihjeteksti, kun ei ole valintaa
 * @param {string} [config.searchPlaceholder="Hae..."] - Hakukentän vihjeteksti
 * @param {boolean} [config.showClearButton=true] - Näytetäänkö "tyhjennä valinta" -painike
 * @param {boolean} [config.useSearch=true] - Näytetäänkö hakukenttä
 * @param {function} [config.onChange] - Kutsutaan, kun valinta muuttuu (parametrina valittu arvo)
 * @param {function} [config.translate] - Optional translation function (key) => string
 */
export function createVanillaDropdown({
	containerElement,
	options,
	placeholder = "Valitse...",
	searchPlaceholder = "Hae...",
	showClearButton = true,
	useSearch = true,
	onChange,
	translate = () => undefined,
  }) {
	if (!containerElement) {
	  throw new Error("containerElement puuttuu tai on virheellinen.");
	}
  
	const selection_close_delay_ms = 0; // odotetaan n ms
	const baseTestId = getDropdownTestIdBase(containerElement);
	let currentOptions = attachStableOptionTestIds(options || [], baseTestId);
  
	const instance = {
	  getValue,
	  setValue,
	  setOptions,
	  open,
	  close,
	  destroy
	};
	containerElement.__dropdown = instance;
  
	containerElement.classList.add("vdw-dropdown");
  
	// Luodaan rivi, jossa input + tyhjennysnappi
	const inputRow = document.createElement('div');
	inputRow.classList.add("vdw-dropdown-input-row");
  
        // Syötekenttä ja nuoli
        const inputWrapper = document.createElement('div');
        inputWrapper.classList.add('vdw-input-wrapper');

        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = placeholder;
        inputEl.readOnly = true;
        inputEl.classList.add('vdw-dropdown-input');
		if (baseTestId) inputEl.dataset.testid = buildDerivedTestId(baseTestId, 'trigger');
        inputWrapper.appendChild(inputEl);

        const chevronContainer = createMaskIconSpan(
            '/frontend/icons/general/chevron-down-icon.svg',
            ['vdw-dropdown-chevron']
        );
        inputWrapper.appendChild(chevronContainer);

        inputRow.appendChild(inputWrapper);
  
	// Tyhjennä-valinta-painike
	let clearBtn = null;
	if (showClearButton) {
	  clearBtn = document.createElement('button');
	  clearBtn.type = 'button';
	  clearBtn.classList.add('vdw-clear-btn');
	  if (baseTestId) clearBtn.dataset.testid = buildDerivedTestId(baseTestId, 'clear-button');
	  clearBtn.textContent = "×";
	  clearBtn.style.display = "none";
	  inputRow.appendChild(clearBtn);
  
	  clearBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		setValue(null, true);
		close(); // suljetaan heti
	  });
	}
  
	// Lisätään "rivi" containeriin
	containerElement.appendChild(inputRow);
  
	// Dropdown-listan kääre
	const listWrapper = document.createElement('div');
	listWrapper.classList.add('vdw-dropdown-list');
	if (baseTestId) listWrapper.dataset.testid = buildDerivedTestId(baseTestId, 'list');
	listWrapper.style.display = 'none';
  
	// (Mahdollinen) hakukenttä
	let searchInput = null;
	if (useSearch) {
	  const searchContainer = document.createElement('div');
	  searchContainer.classList.add('vdw-dropdown-search');
  
	  searchInput = document.createElement('input');
	  searchInput.type = 'text';
	  searchInput.placeholder = searchPlaceholder;
	  searchInput.classList.add('vdw-dropdown-search-input');
	  if (baseTestId) searchInput.dataset.testid = buildDerivedTestId(baseTestId, 'search-input');
  
	  searchContainer.appendChild(searchInput);
	  listWrapper.appendChild(searchContainer);
  
	  searchInput.addEventListener('input', () => {
		renderList(searchInput.value.trim());
	  });
	}
  
	// Varsinaiset vaihtoehdot
	const optionsList = document.createElement('div');
	optionsList.classList.add('vdw-dropdown-options');
	if (baseTestId) optionsList.dataset.testid = buildDerivedTestId(baseTestId, 'options');
	listWrapper.appendChild(optionsList);
  
	document.body.appendChild(listWrapper);
  
	let selectedValue = null;
  
	// Klikkaus inputtiin -> avaa/sulje
	inputEl.addEventListener('click', (e) => {
	  e.stopPropagation();
	  toggle();
	});
  
	// Klikkaus muualle sulkee
	const handleOutsideClick = (e) => {
	  if (!containerElement.contains(e.target) && !listWrapper.contains(e.target)) {
		close();
	  }
	};
	document.addEventListener('click', handleOutsideClick);

	let isTrackingPosition = false;
	let rafHandle = 0;

	function positionListWrapper() {
	  if (listWrapper.style.display === 'none') {
		return;
	  }

	  const anchorRect = inputRow.getBoundingClientRect();
	  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
	  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
	  const viewportMargin = 8;
	  const dropdownGap = 4;
	  const preferredDropdownHeight = 400;
	  const maxWidth = Math.max(160, viewportWidth - (viewportMargin * 2));
	  const width = Math.min(anchorRect.width || maxWidth, maxWidth);
	  const left = Math.min(
		Math.max(anchorRect.left, viewportMargin),
		Math.max(viewportMargin, viewportWidth - width - viewportMargin)
	  );
	  const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - viewportMargin - dropdownGap);
	  const spaceAbove = Math.max(0, anchorRect.top - viewportMargin - dropdownGap);
	  const shouldOpenUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
	  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
	  const maxHeight = Math.max(0, Math.min(preferredDropdownHeight, availableHeight));

	  listWrapper.classList.toggle('vdw-dropdown-list--open-upward', shouldOpenUpward);
	  listWrapper.style.left = `${left}px`;
	  listWrapper.style.width = `${width}px`;
	  listWrapper.style.maxHeight = `${maxHeight}px`;
	  listWrapper.style.top = shouldOpenUpward ? '' : `${anchorRect.bottom + dropdownGap}px`;
	  listWrapper.style.bottom = shouldOpenUpward
		? `${viewportHeight - anchorRect.top + dropdownGap}px`
		: '';
	}

	function schedulePositionUpdate() {
	  if (listWrapper.style.display === 'none' || rafHandle) {
		return;
	  }
	  rafHandle = window.requestAnimationFrame(() => {
		rafHandle = 0;
		positionListWrapper();
	  });
	}

	function startPositionTracking() {
	  if (isTrackingPosition) {
		return;
	  }
	  isTrackingPosition = true;
	  window.addEventListener('resize', schedulePositionUpdate);
	  window.addEventListener('scroll', schedulePositionUpdate, true);
	}

	function stopPositionTracking() {
	  if (!isTrackingPosition) {
		return;
	  }
	  isTrackingPosition = false;
	  window.removeEventListener('resize', schedulePositionUpdate);
	  window.removeEventListener('scroll', schedulePositionUpdate, true);
	  if (rafHandle) {
		window.cancelAnimationFrame(rafHandle);
		rafHandle = 0;
	  }
	}
  
	function renderList(filterText = "") {
	  optionsList.replaceChildren();
  
	  const filtered = currentOptions.filter(o =>
		o.label.toLowerCase().includes(filterText.toLowerCase())
	  );
  
	  if (filtered.length === 0) {
		const noResults = document.createElement('div');
		noResults.classList.add('vdw-no-results');
		noResults.textContent = "Ei tuloksia";
		optionsList.appendChild(noResults);
		return;
	  }
  
          filtered.forEach(opt => {
                const item = document.createElement('div');
                item.classList.add('vdw-option');
					if (opt.__dropdownOptionTestId) {
						item.dataset.testid = opt.__dropdownOptionTestId;
					}
                item.textContent = opt.label;
                if (opt.langKey) item.dataset.langKey = opt.langKey;
  
		if (opt.value === selectedValue) {
		  item.classList.add('vdw-selected');
		}
  
		item.addEventListener('click', () => {
		  setValue(opt.value, true);
  
		  // Päivitetään valinnan ulkoinen korostus
		  const allItems = optionsList.querySelectorAll('.vdw-option');
		  allItems.forEach(el => el.classList.remove('vdw-selected'));
		  item.classList.add('vdw-selected');
  
		  // Odotetaan n ms ennen sulkemista
		  setTimeout(() => {
			close();
		  }, selection_close_delay_ms);
		});
  
		optionsList.appendChild(item);
	  });
	}
  
        function setValue(value, triggerChange = false) {
          selectedValue = value;
          const found = currentOptions.find(o => o.value === value);

          if (found && found.langKey) {
                inputEl.dataset.langKey = found.langKey;
                inputEl.value = resolveDropdownOptionLabel(found, translate);
          } else {
                delete inputEl.dataset.langKey;
                inputEl.value = found ? found.label : "";
          }

          if (clearBtn) {
                clearBtn.style.display = selectedValue ? "inline-block" : "none";
          }
          if (triggerChange && typeof onChange === 'function') {
                onChange(selectedValue);
          }
        }
  
	function getValue() {
	  return selectedValue;
	}
  
	function setOptions(newOptions) {
	  currentOptions = attachStableOptionTestIds(newOptions || [], baseTestId);
	  setValue(null, false);
	  renderList("");
	}
  
	function open() {
	  listWrapper.style.display = 'block';
	  listWrapper.style.visibility = 'hidden';
	  startPositionTracking();
	  positionListWrapper();
	  listWrapper.style.visibility = '';
	  if (searchInput) {
		searchInput.value = "";
		searchInput.focus();
	  }
	  renderList("");
	}
  
	function close() {
	  listWrapper.style.display = 'none';
	  listWrapper.style.visibility = '';
	  listWrapper.classList.remove('vdw-dropdown-list--open-upward');
	  listWrapper.style.top = '';
	  listWrapper.style.bottom = '';
	  stopPositionTracking();
	}

	function destroy() {
	  close();
	  document.removeEventListener('click', handleOutsideClick);
	  listWrapper.remove();
	  if (containerElement.__dropdown === instance) {
		delete containerElement.__dropdown;
	  }
	}
  
	function toggle() {
	  if (listWrapper.style.display === 'none') {
		open();
	  } else {
		close();
	  }
	}
  
	renderList("");
  
	return instance;
  }
  
