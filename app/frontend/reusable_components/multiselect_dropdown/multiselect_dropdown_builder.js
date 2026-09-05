// multiselect_dropdown_builder.js
// Builds a reusable multiselect dropdown component with include toggles and an explicit exclude action.
// Bridges option data, search/filter behavior, and include/exclude selection callbacks into one widget.
// Exists to provide a framework-free multiselect dropdown for filter bars and other UI surfaces.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';

let multiselectDropdownSequence = 0;

/**
 * Creates a multiselect dropdown component with include toggles and an explicit exclude action.
 *
 * @param {Object} config
 * @param {HTMLElement} config.containerElement - Element to mount into
 * @param {Array<{value: string, label: string, searchTerms?: string[], groupLabel?: string}>} config.options - Options list
 * @param {string} [config.placeholder="Select..."] - Trigger placeholder
 * @param {string} [config.searchPlaceholder="Search..."] - Search field placeholder
 * @param {boolean} [config.useSearch=true] - Show search field
 * @param {HTMLElement} [config.portalElement=document.body] - Element that owns the floating list
 * @param {{ includeValues?: string[], excludeValues?: string[] }} [config.initialState] - Initial per-option filter state
 * @param {string} [config.excludeLabel="Exclude"] - Label for the per-row exclude action
 * @param {string} [config.resetLabel="Reset"] - Label for the per-row reset action shown for excluded values
 * @param {string} [config.excludeTooltip="Exclude this value from results"] - Tooltip for the exclude action
 * @param {string} [config.resetTooltip="Remove the excluded state for this value"] - Tooltip for the reset action
 * @param {boolean} [config.allowExclude=true] - Whether per-row exclude actions are rendered
 * @param {number|null} [config.maxSelections=null] - Maximum included values; null keeps normal multiselect behavior
 * @param {string} [config.selectedCountLabel="selected"] - Summary label for multiple selected values
 * @param {string} [config.excludedCountLabel="excluded"] - Summary label for multiple excluded values
 * @param {string} [config.noResultsLabel="No results"] - Empty search-result label
 * @param {string} [config.clearLabel="Clear selection"] - Accessible clear-button label
 * @param {function(string): Promise<Array>|Array} [config.onSearch] - Optional server-backed option search
 * @param {number} [config.searchDebounceMs=200] - Delay before a server-backed search
 * @param {function} [config.onChange] - Called with { includeValues, excludeValues } on change
 */
export function createMultiselectDropdown({
	containerElement,
	options,
	placeholder = "Select...",
	searchPlaceholder = "Search...",
	useSearch = true,
	portalElement = document.body,
	initialState = {},
	excludeLabel = "Exclude",
	resetLabel = "Reset",
	excludeTooltip = "Exclude this value from results",
	resetTooltip = "Remove the excluded state for this value",
	allowExclude = true,
	maxSelections = null,
	selectedCountLabel = "selected",
	excludedCountLabel = "excluded",
	noResultsLabel = "No results",
	clearLabel = "Clear selection",
	onSearch = null,
	searchDebounceMs = 200,
	onChange,
}) {
	if (!containerElement) {
		throw new Error("containerElement is required.");
	}
	if (!(portalElement instanceof HTMLElement)) {
		throw new Error("portalElement must be an HTML element.");
	}

	let currentOptions = options || [];
	let optionStates = new Map();
	let disabled = false;
	let searchTimer = null;
	let searchGeneration = 0;
	applyState(initialState);

	const instance = {
		getValue,
		getLabelsForValues,
		getState,
		setValue,
		setOptions,
		setDisabled,
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
	inputEl.setAttribute('role', 'combobox');
	inputEl.setAttribute('aria-haspopup', 'listbox');
	inputEl.setAttribute('aria-expanded', 'false');
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
	clearBtn.title = clearLabel;
	clearBtn.setAttribute('aria-label', clearLabel);
	clearBtn.style.display = "none";
	inputRow.appendChild(clearBtn);

	clearBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (disabled) return;
		setValue({ includeValues: [], excludeValues: [] }, true);
		close();
	});

	containerElement.appendChild(inputRow);

	// --- Dropdown list ---
	const listWrapper = document.createElement('div');
	listWrapper.classList.add('msd-dropdown-list');
	listWrapper.style.display = 'none';
	listWrapper.id = `msd_dropdown_list_${++multiselectDropdownSequence}`;
	// The caller owns the surrounding overlay context. Keeping that decision at
	// the composition boundary lets this reusable component stay unaware of
	// modals while ensuring its floating list remains clickable above them.
	portalElement.appendChild(listWrapper);

	// Search field
	let searchInput = null;
	if (useSearch) {
		const searchContainer = document.createElement('div');
		searchContainer.classList.add('msd-dropdown-search');

		searchInput = document.createElement('input');
		searchInput.type = 'text';
		searchInput.placeholder = searchPlaceholder;
		searchInput.setAttribute('aria-label', searchPlaceholder);
		searchInput.classList.add('msd-dropdown-search-input');

		searchContainer.appendChild(searchInput);
		listWrapper.appendChild(searchContainer);

		searchInput.addEventListener('input', () => {
			const searchText = searchInput.value.trim();
			renderList(searchText);
			scheduleRemoteSearch(searchText);
		});
		searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close();
				inputEl.focus({ preventScroll: true });
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				focusOptionAt(0);
			}
		});
	}

	// Options container
	const optionsList = document.createElement('div');
	optionsList.classList.add('msd-dropdown-options');
	optionsList.id = `${listWrapper.id}_options`;
	optionsList.setAttribute('role', 'listbox');
	optionsList.setAttribute('aria-multiselectable', String(maxSelections !== 1));
	inputEl.setAttribute('aria-controls', optionsList.id);
	listWrapper.appendChild(optionsList);

	// --- Toggle on input click ---
	inputEl.addEventListener('click', (e) => {
		e.stopPropagation();
		if (disabled) return;
		toggle();
	});
	inputEl.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			close();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			open();
		}
	});

	// --- Close on outside click ---
	const handleOutsideClick = (e) => {
		if (!containerElement.contains(e.target) && !listWrapper.contains(e.target)) {
			close();
		}
	};
	document.addEventListener('click', handleOutsideClick);
	const ownerView = containerElement.closest('#tabs_container > .content_div');
	const handleOwnerViewDeactivation = () => close();
	ownerView?.addEventListener(VIEW_DEACTIVATE_EVENT, handleOwnerViewDeactivation);

	let isTrackingPosition = false;
	let rafHandle = 0;
	let ownerConnectionObserver = null;
	let destroyed = false;

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

	function startOwnerConnectionTracking() {
		if (ownerConnectionObserver || typeof MutationObserver !== 'function') {
			return;
		}
		ownerConnectionObserver = new MutationObserver(() => {
			// The popup is portalled outside its owning view. Destroy it when SPA
			// navigation removes the anchor so an orphaned list cannot cover the
			// next admin page or retain document/window listeners.
			if (!containerElement.isConnected) {
				destroy();
			}
		});
		ownerConnectionObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	function stopOwnerConnectionTracking() {
		ownerConnectionObserver?.disconnect();
		ownerConnectionObserver = null;
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

		const normalizedFilter = normalizeSearchText(filterText);
		const filtered = currentOptions.filter((option) =>
			searchableOptionText(option).includes(normalizedFilter)
		);

		if (filtered.length === 0) {
			const noResults = document.createElement('div');
			noResults.classList.add('msd-no-results');
			noResults.textContent = noResultsLabel;
			optionsList.appendChild(noResults);
			return;
		}

		const groupedOptions = [];
		const groupByLabel = new Map();
		filtered.forEach((option) => {
			const groupLabel = String(option.groupLabel || "");
			let group = groupByLabel.get(groupLabel);
			if (!group) {
				group = { label: groupLabel, options: [] };
				groupByLabel.set(groupLabel, group);
				groupedOptions.push(group);
			}
			group.options.push(option);
		});

		groupedOptions.forEach((optionGroup) => {
			const groupElement = document.createElement('div');
			groupElement.classList.add('msd-option-group');
			if (optionGroup.label) {
				groupElement.setAttribute('role', 'group');
				groupElement.setAttribute('aria-label', optionGroup.label);
				const heading = document.createElement('div');
				heading.classList.add('msd-option-group-label');
				heading.setAttribute('aria-hidden', 'true');
				heading.textContent = optionGroup.label;
				groupElement.appendChild(heading);
			}

			optionGroup.options.forEach((opt) => {
			const item = document.createElement('div');
			item.classList.add('msd-option');
			item.dataset.optionValue = String(opt.value);
			item.tabIndex = disabled ? -1 : 0;
			item.setAttribute('role', 'option');

			const optionState = getOptionState(opt.value);
			item.dataset.state = optionState;
			item.classList.toggle('msd-option--include', optionState === 'include');
			item.classList.toggle('msd-option--exclude', optionState === 'exclude');
			item.setAttribute('aria-selected', String(optionState === 'include'));

			const checkbox = document.createElement('button');
			checkbox.type = 'button';
			checkbox.classList.add('msd-option-checkbox');
			checkbox.dataset.state = optionState;
			checkbox.setAttribute('role', 'checkbox');
			checkbox.setAttribute('aria-checked', ariaCheckedValueForState(optionState));
			checkbox.value = opt.value;
			checkbox.disabled = disabled;
			checkbox.setAttribute('aria-label', opt.label);

			const labelSpan = document.createElement('span');
			labelSpan.classList.add('msd-option-label');
			labelSpan.textContent = opt.label;

			const toggleOption = (e) => {
				e?.stopPropagation?.();
				if (disabled) return;
				toggleCheckboxState(opt.value);
			};
			checkbox.addEventListener('click', toggleOption);
			item.addEventListener('click', toggleOption);
			item.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					toggleOption(e);
					window.requestAnimationFrame(() => focusOptionValue(opt.value));
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					close();
					inputEl.focus({ preventScroll: true });
					return;
				}
				const options = getRenderedOptions();
				const currentIndex = options.indexOf(item);
				let nextIndex = currentIndex;
				if (e.key === 'ArrowDown') nextIndex = currentIndex + 1;
				if (e.key === 'ArrowUp') nextIndex = currentIndex - 1;
				if (e.key === 'Home') nextIndex = 0;
				if (e.key === 'End') nextIndex = options.length - 1;
				if (nextIndex !== currentIndex) {
					e.preventDefault();
					focusOptionAt(Math.max(0, Math.min(nextIndex, options.length - 1)));
				}
			});

			item.appendChild(checkbox);
			item.appendChild(labelSpan);
			if (allowExclude) {
				const actionButton = document.createElement('button');
				actionButton.type = 'button';
				actionButton.disabled = disabled;
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
			groupElement.appendChild(item);
			});
			optionsList.appendChild(groupElement);
		});
	}

	function getRenderedOptions() {
		return Array.from(optionsList.querySelectorAll('.msd-option'));
	}

	function focusOptionAt(index) {
		getRenderedOptions()[index]?.focus({ preventScroll: true });
	}

	function focusOptionValue(value) {
		getRenderedOptions()
			.find((option) => option.dataset.optionValue === String(value))
			?.focus({ preventScroll: true });
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

	function setOptions(newOptions, options = {}) {
		const incomingOptions = Array.isArray(newOptions) ? newOptions : [];
		currentOptions = options.preserveSelected === true
			? mergeSelectedOptions(currentOptions, incomingOptions, optionStates)
			: incomingOptions;
		updateDisplay();
		renderList(options.preserveSearchText === true ? searchInput?.value?.trim() || "" : "");
	}

	function scheduleRemoteSearch(searchText, { immediate = false } = {}) {
		if (typeof onSearch !== 'function' || disabled || destroyed) return;
		if (searchTimer !== null) {
			window.clearTimeout(searchTimer);
			searchTimer = null;
		}
		const generation = ++searchGeneration;
		const runSearch = async () => {
			searchTimer = null;
			try {
				const nextOptions = await onSearch(searchText);
				if (destroyed || generation !== searchGeneration) return;
				setOptions(nextOptions, {
					preserveSelected: true,
					preserveSearchText: true,
				});
			} catch (error) {
				console.warn('multiselect server search failed:', error);
			}
		};
		if (immediate) {
			void runSearch();
			return;
		}
		const delay = Number.isFinite(searchDebounceMs)
			? Math.max(0, searchDebounceMs)
			: 200;
		searchTimer = window.setTimeout(runSearch, delay);
	}

	function setDisabled(nextDisabled) {
		disabled = Boolean(nextDisabled);
		containerElement.classList.toggle('msd-dropdown--disabled', disabled);
		inputEl.disabled = disabled;
		clearBtn.disabled = disabled;
		searchInput?.toggleAttribute('disabled', disabled);
		if (disabled) close();
		renderList(searchInput?.value?.trim() || "");
	}

	function open() {
		if (disabled || destroyed || !containerElement.isConnected) return;
		listWrapper.style.display = 'flex';
		inputEl.setAttribute('aria-expanded', 'true');
		listWrapper.style.visibility = 'hidden';
		startPositionTracking();
		startOwnerConnectionTracking();
		positionListWrapper();
		listWrapper.style.visibility = '';
		if (searchInput) {
			searchInput.value = "";
			searchInput.focus();
		}
		renderList("");
		scheduleRemoteSearch("", { immediate: true });
	}

	function close() {
		listWrapper.style.display = 'none';
		inputEl.setAttribute('aria-expanded', 'false');
		listWrapper.style.visibility = '';
		listWrapper.classList.remove('msd-dropdown-list--open-upward');
		listWrapper.style.top = '';
		listWrapper.style.bottom = '';
		stopPositionTracking();
		stopOwnerConnectionTracking();
	}

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		searchGeneration += 1;
		if (searchTimer !== null) {
			window.clearTimeout(searchTimer);
			searchTimer = null;
		}
		close();
		document.removeEventListener('click', handleOutsideClick);
		ownerView?.removeEventListener(VIEW_DEACTIVATE_EVENT, handleOwnerViewDeactivation);
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
		if (state === 'include' && Number.isInteger(maxSelections) && maxSelections > 0) {
			const priorIncludedValues = Array.from(optionStates.entries())
				.filter(([existingValue, existingState]) => (
					existingState === 'include' && existingValue !== normalizedValue
				))
				.map(([existingValue]) => existingValue);
			while (priorIncludedValues.length >= maxSelections) {
				optionStates.delete(priorIncludedValues.shift());
			}
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

function normalizeSearchText(value) {
	return String(value ?? "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase();
}

// Option labels stay concise while searchTerms can contain stable IDs and
// secondary metadata. This keeps feature-specific identity knowledge out of
// the reusable dropdown and avoids exposing fields the caller did not choose.
function searchableOptionText(option) {
	const searchTerms = Array.isArray(option?.searchTerms)
		? option.searchTerms
		: [];
	return normalizeSearchText([
		option?.label,
		option?.value,
		option?.groupLabel,
		...searchTerms,
	].filter(Boolean).join(" "));
}

function mergeSelectedOptions(currentOptions, incomingOptions, optionStates) {
	const nextOptions = [...incomingOptions];
	const incomingValues = new Set(nextOptions.map((option) => String(option.value)));
	currentOptions.forEach((option) => {
		const value = String(option.value);
		if (optionStates.has(value) && !incomingValues.has(value)) {
			nextOptions.push(option);
		}
	});
	return nextOptions;
}
