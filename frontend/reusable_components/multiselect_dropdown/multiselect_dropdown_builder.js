// multiselect_dropdown_builder.js
// Builds a reusable multiselect dropdown component with include toggles and an explicit exclude action.
// Bridges option data, search/filter behavior, and include/exclude selection callbacks into one widget.
// Exists to provide a framework-free multiselect dropdown for filter bars and other UI surfaces.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';

/**
 * Creates a multiselect dropdown component with include toggles and an explicit exclude action.
 *
 * @param {Object} config
 * @param {HTMLElement} config.containerElement - Element to mount into
 * @param {Array<{value: string, label: string}>} config.options - Options list
 * @param {string} [config.placeholder="Select..."] - Trigger placeholder
 * @param {string} [config.searchPlaceholder="Search..."] - Search field placeholder
 * @param {boolean} [config.useSearch=true] - Show search field
 * @param {{ includeValues?: string[], excludeValues?: string[] }} [config.initialState] - Initial per-option filter state
 * @param {string} [config.excludeLabel="Exclude"] - Label for the per-row exclude action
 * @param {string} [config.resetLabel="Reset"] - Label for the per-row reset action shown for excluded values
 * @param {string} [config.excludeTooltip="Exclude this value from results"] - Tooltip for the exclude action
 * @param {string} [config.resetTooltip="Remove the excluded state for this value"] - Tooltip for the reset action
 * @param {boolean} [config.allowExclude=true] - Whether per-row exclude actions are rendered
 * @param {string} [config.selectedCountLabel="selected"] - Summary label for multiple selected values
 * @param {string} [config.excludedCountLabel="excluded"] - Summary label for multiple excluded values
 * @param {function} [config.onChange] - Called with { includeValues, excludeValues } on change
 */
export function createMultiselectDropdown({
	containerElement,
	options,
	placeholder = "Select...",
	searchPlaceholder = "Search...",
	useSearch = true,
	initialState = {},
	excludeLabel = "Exclude",
	resetLabel = "Reset",
	excludeTooltip = "Exclude this value from results",
	resetTooltip = "Remove the excluded state for this value",
	allowExclude = true,
	selectedCountLabel = "selected",
	excludedCountLabel = "excluded",
	onChange,
}) {
	if (!containerElement) {
		throw new Error("containerElement is required.");
	}

	let currentOptions = options || [];
	let optionStates = new Map();
	applyState(initialState);

	const instance = {
		getValue,
		getLabelsForValues,
		getState,
		setValue,
		setOptions,
		open,
		close,
		destroy,
	};
	containerElement.__dropdown = instance;

	containerElement.classList.add("msd-dropdown");
	containerElement.classList.toggle("msd-dropdown--include-only", !allowExclude);

	// --- Trigger row: input + clear button ---
	const inputRow = document.createElement('div');
	inputRow.classList.add("msd-dropdown-input-row");

	const inputWrapper = document.createElement('div');
	inputWrapper.classList.add('msd-input-wrapper');

	const inputEl = document.createElement('input');
	inputEl.type = 'text';
	inputEl.placeholder = placeholder;
	inputEl.readOnly = true;
	inputEl.classList.add('msd-dropdown-input');
	inputWrapper.appendChild(inputEl);

	const chevronContainer = createMaskIconSpan(
		'/frontend/icons/general/chevron-down-icon.svg',
		['msd-dropdown-chevron']
	);
	inputWrapper.appendChild(chevronContainer);

	inputRow.appendChild(inputWrapper);

	const clearBtn = document.createElement('button');
	clearBtn.type = 'button';
	clearBtn.classList.add('msd-clear-btn');
	clearBtn.textContent = "×";
	clearBtn.style.display = "none";
	inputRow.appendChild(clearBtn);

	clearBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		setValue({ includeValues: [], excludeValues: [] }, true);
		close();
	});

	containerElement.appendChild(inputRow);

	// --- Dropdown list ---
	const listWrapper = document.createElement('div');
	listWrapper.classList.add('msd-dropdown-list');
	listWrapper.style.display = 'none';
	document.body.appendChild(listWrapper);

	// Search field
	let searchInput = null;
	if (useSearch) {
		const searchContainer = document.createElement('div');
		searchContainer.classList.add('msd-dropdown-search');

		searchInput = document.createElement('input');
		searchInput.type = 'text';
		searchInput.placeholder = searchPlaceholder;
		searchInput.classList.add('msd-dropdown-search-input');

		searchContainer.appendChild(searchInput);
		listWrapper.appendChild(searchContainer);

		searchInput.addEventListener('input', () => {
			renderList(searchInput.value.trim());
		});
	}

	// Options container
	const optionsList = document.createElement('div');
	optionsList.classList.add('msd-dropdown-options');
	listWrapper.appendChild(optionsList);

	// --- Toggle on input click ---
	inputEl.addEventListener('click', (e) => {
		e.stopPropagation();
		toggle();
	});

	// --- Close on outside click ---
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

		listWrapper.classList.toggle('msd-dropdown-list--open-upward', shouldOpenUpward);
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
			noResults.classList.add('msd-no-results');
			noResults.textContent = "No results";
			optionsList.appendChild(noResults);
			return;
		}

		filtered.forEach(opt => {
			const item = document.createElement('div');
			item.classList.add('msd-option');
			item.tabIndex = 0;
			item.setAttribute('role', 'button');

			const optionState = getOptionState(opt.value);
			item.dataset.state = optionState;
			item.classList.toggle('msd-option--include', optionState === 'include');
			item.classList.toggle('msd-option--exclude', optionState === 'exclude');

			const checkbox = document.createElement('button');
			checkbox.type = 'button';
			checkbox.classList.add('msd-option-checkbox');
			checkbox.dataset.state = optionState;
			checkbox.setAttribute('role', 'checkbox');
			checkbox.setAttribute('aria-checked', ariaCheckedValueForState(optionState));
			checkbox.value = opt.value;
			checkbox.setAttribute('aria-label', opt.label);

			const labelSpan = document.createElement('span');
			labelSpan.classList.add('msd-option-label');
			labelSpan.textContent = opt.label;

			const toggleOption = (e) => {
				e?.stopPropagation?.();
				toggleCheckboxState(opt.value);
			};
			checkbox.addEventListener('click', toggleOption);
			item.addEventListener('click', toggleOption);
			item.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					toggleOption(e);
				}
			});

			item.appendChild(checkbox);
			item.appendChild(labelSpan);
			if (allowExclude) {
				const actionButton = document.createElement('button');
				actionButton.type = 'button';
				actionButton.classList.add('msd-option-action');
				const isExcluded = optionState === 'exclude';
				const actionLabel = isExcluded ? resetLabel : excludeLabel;
				const actionTooltip = isExcluded ? resetTooltip : excludeTooltip;
				actionButton.dataset.action = isExcluded ? 'reset' : 'exclude';
				actionButton.dataset.langKey = isExcluded ? 'reset' : 'exclude';
				actionButton.dataset.titleLangKey = isExcluded ? 'reset_filter_option' : 'exclude_filter_option';
				actionButton.textContent = actionLabel;
				actionButton.title = actionTooltip;
				actionButton.setAttribute(
					'aria-label',
					`${actionLabel} ${opt.label}`
				);
				actionButton.addEventListener('click', (e) => {
					e.stopPropagation();
					if (isExcluded) {
						setOptionStateAndSync(opt.value, 'neutral');
						return;
					}
					activateExcludeState(opt.value);
				});
				item.appendChild(actionButton);
			}
			optionsList.appendChild(item);
		});
	}

	function updateDisplay() {
		const includeLabels = getLabelsForValues(getValuesByState('include'));
		const excludeLabels = getLabelsForValues(getValuesByState('exclude'));
		const totalSelections = includeLabels.length + excludeLabels.length;

		if (totalSelections === 0) {
			inputEl.value = "";
			clearBtn.style.display = "none";
		} else if (totalSelections <= 2) {
			const parts = [
				...includeLabels,
				...excludeLabels.map((label) => `\u2260 ${label}`),
			];
			inputEl.value = parts.join(", ");
			clearBtn.style.display = "inline-block";
		} else {
			const parts = [];
			if (includeLabels.length > 0) {
				parts.push(`${includeLabels.length} ${selectedCountLabel}`);
			}
			if (excludeLabels.length > 0) {
				parts.push(`${excludeLabels.length} ${excludedCountLabel}`);
			}
			inputEl.value = parts.join(", ");
			clearBtn.style.display = "inline-block";
		}
	}

	function emitChange() {
		if (typeof onChange === 'function') {
			onChange(getState());
		}
	}

	function getValue() {
		return getValuesByState('include');
	}

	function getState() {
		return {
			includeValues: getValuesByState('include'),
			excludeValues: getValuesByState('exclude'),
		};
	}

	function getLabelsForValues(values = []) {
		const labelByValue = new Map(
			currentOptions.map((option) => [String(option.value), option.label || String(option.value)])
		);
		return values.map((value) => labelByValue.get(String(value)) || String(value));
	}

	function setValue(nextValue, triggerChange = false) {
		applyState(nextValue);
		updateDisplay();
		renderList(searchInput?.value?.trim() || "");
		if (triggerChange) {
			emitChange();
		}
	}

	function setOptions(newOptions) {
		currentOptions = newOptions || [];
		updateDisplay();
		renderList("");
	}

	function open() {
		listWrapper.style.display = 'flex';
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
		listWrapper.classList.remove('msd-dropdown-list--open-upward');
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
	updateDisplay();

	return instance;

	function applyState(nextState) {
		optionStates = new Map();
		const normalizedState = normalizeState(nextState);
		normalizedState.includeValues.forEach((value) => {
			optionStates.set(String(value), 'include');
		});
		normalizedState.excludeValues.forEach((value) => {
			optionStates.set(String(value), 'exclude');
		});
	}

	function getOptionState(value) {
		return optionStates.get(String(value)) || 'neutral';
	}

	function setOptionState(value, state) {
		const normalizedValue = String(value);
		if (state === 'neutral') {
			optionStates.delete(normalizedValue);
			return;
		}
		optionStates.set(normalizedValue, state);
	}

	function toggleCheckboxState(value) {
		const currentState = getOptionState(value);
		const nextState = currentState === 'include' ? 'neutral' : currentState === 'neutral' ? 'include' : 'neutral';
		setOptionStateAndSync(value, nextState);
	}

	function activateExcludeState(value) {
		if (!allowExclude) {
			return;
		}
		setOptionStateAndSync(value, 'exclude');
	}

	function setOptionStateAndSync(value, state) {
		setOptionState(value, state);
		updateDisplay();
		renderList(searchInput?.value?.trim() || "");
		emitChange();
	}

	function getValuesByState(targetState) {
		return Array.from(optionStates.entries())
			.filter(([, state]) => state === targetState)
			.map(([value]) => value);
	}
}

function normalizeState(nextState) {
	if (Array.isArray(nextState)) {
		return {
			includeValues: nextState.map((value) => String(value)),
			excludeValues: [],
		};
	}

	const includeValues = Array.isArray(nextState?.includeValues)
		? nextState.includeValues.map((value) => String(value))
		: [];
	const excludeValues = Array.isArray(nextState?.excludeValues)
		? nextState.excludeValues.map((value) => String(value))
		: [];

	return {
		includeValues,
		excludeValues,
	};
}

function ariaCheckedValueForState(state) {
	if (state === 'include') return 'true';
	if (state === 'exclude') return 'mixed';
	return 'false';
}
