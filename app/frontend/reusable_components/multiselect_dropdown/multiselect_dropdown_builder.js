// multiselect_dropdown_builder.js
// Builds a reusable multiselect dropdown component with include toggles and an explicit exclude action.
// Bridges option data, search/filter behavior, and include/exclude selection callbacks into one widget.
// Exists to provide a framework-free multiselect dropdown for filter bars and other UI surfaces.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { createMultiselectPopupController } from './multiselect_dropdown_popup_controller.js';
import { createMultiselectOptionPrinter } from './multiselect_dropdown_option_printer.js';
import { createMultiselectLabelUpdater } from './multiselect_dropdown_labels.js';
import {
	mergeSelectedMultiselectOptions,
	normalizeMultiselectState,
} from './multiselect_dropdown_data.js';

let multiselectDropdownSequence = 0;

/**
 * Creates a multiselect dropdown component with include toggles and an explicit exclude action.
 *
 * @param {Object} config
 * @param {HTMLElement} config.containerElement - Element to mount into
 * @param {Array<{value: string, label: string, searchTerms?: string[], groupLabel?: string, count?: number, dimmed?: boolean}>} config.options - Options list
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
 * @param {{title:string, showCloseButton?:boolean}|null} [config.popupHeader=null] - Opt-in dialog header
 * @param {string} [config.closeLabel="Close"] - Header close action's name and tooltip
 * @param {HTMLElement|null} [config.beforeSearchElement=null] - Caller-owned content mounted once
 * @param {string|null} [config.popupDescriptionId=null] - Hint describing dialog and listbox
 * @param {HTMLButtonElement|null} [config.triggerElement=null] - External trigger; omits the input row
 * @param {HTMLElement} [config.ownerElement=config.containerElement] - Explicit lifetime boundary
 * @param {number} [config.minPopupWidth=0] - Minimum desktop width, bounded by the viewport
 * @param {{max:number, getSelectionCount?:function}|null} [config.selectionLimit=null] - Blocks new includes
 * @param {boolean} [config.preserveViewState=false] - Preserve query, option nodes, focus and scroll
 * @param {function} [config.onOpen] - Called only on a closed-to-open transition
 * @param {function} [config.onClose] - Called with {reason} only on an open-to-closed transition
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
	popupHeader = null,
	closeLabel = "Close",
	beforeSearchElement = null,
	popupDescriptionId = null,
	triggerElement = null,
	ownerElement = null,
	minPopupWidth = 0,
	selectionLimit = null,
	preserveViewState = false,
	onOpen = null,
	onClose = null,
}) {
	const labels = { placeholder, searchPlaceholder, excludeLabel, resetLabel, excludeTooltip,
		resetTooltip, selectedCountLabel, excludedCountLabel, noResultsLabel, clearLabel, closeLabel, popupTitle: popupHeader?.title || placeholder };
	if (!containerElement) {
		throw new Error("containerElement is required.");
	}
	if (!(portalElement instanceof HTMLElement)) {
		throw new Error("portalElement must be an HTML element.");
	}

	if (selectionLimit && maxSelections !== null) throw new Error("selectionLimit and maxSelections cannot be combined.");
	if (selectionLimit && (!Number.isSafeInteger(selectionLimit.max) || selectionLimit.max < 1)) {
		throw new Error("selectionLimit.max must be a positive safe integer.");
	}
	const explicitOwner = ownerElement !== null;
	ownerElement = ownerElement || containerElement;
	const richPopup = Boolean(popupHeader || beforeSearchElement);
	let destroyed = false;
	let isOpen = false;
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
	inputEl.placeholder = labels.placeholder;
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
	clearBtn.title = labels.clearLabel;
	clearBtn.setAttribute('aria-label', labels.clearLabel);
	clearBtn.style.display = "none";
	inputRow.appendChild(clearBtn);

	clearBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (disabled) return;
		setValue({ includeValues: [], excludeValues: [] }, true);
		close();
	});

	if (!triggerElement) containerElement.appendChild(inputRow);
	const trigger = triggerElement || inputEl;

	// --- Dropdown list ---
	const listWrapper = document.createElement('div');
	listWrapper.classList.add('msd-dropdown-list');
	listWrapper.style.display = 'none';
	listWrapper.id = `msd_dropdown_list_${++multiselectDropdownSequence}`;
	// The caller owns the surrounding overlay context. Keeping that decision at
	// the composition boundary lets this reusable component stay unaware of
	// modals while ensuring its floating list remains clickable above them.
	portalElement.appendChild(listWrapper);
	listWrapper.classList.toggle('msd-dropdown--include-only', !allowExclude);
	listWrapper.classList.toggle('msd-dropdown-list--rich', richPopup);
	let popupTitle = null;
	let closeButton = null;
	if (richPopup) {
		listWrapper.setAttribute('role', 'dialog');
		listWrapper.setAttribute('aria-modal', 'false');
		const header = document.createElement('div');
		header.className = 'msd-popup-header';
		popupTitle = document.createElement('h3');
		popupTitle.id = `${listWrapper.id}_title`;
		popupTitle.textContent = labels.popupTitle;
		header.appendChild(popupTitle);
		listWrapper.setAttribute('aria-labelledby', popupTitle.id);
		if (popupHeader?.showCloseButton === true) {
			closeButton = document.createElement('button');
			closeButton.type = 'button';
			closeButton.className = 'msd-popup-close';
			closeButton.textContent = '×';
			closeButton.title = labels.closeLabel;
			closeButton.setAttribute('aria-label', labels.closeLabel);
			closeButton.addEventListener('click', () => close({ returnFocus: true, reason: 'close-button' }));
			header.appendChild(closeButton);
		}
		listWrapper.appendChild(header);
	}
	if (beforeSearchElement) listWrapper.appendChild(beforeSearchElement);
	if (popupDescriptionId) listWrapper.setAttribute('aria-describedby', popupDescriptionId);

	// Search field
	let searchInput = null;
	if (useSearch) {
		const searchContainer = document.createElement('div');
		searchContainer.classList.add('msd-dropdown-search');

		searchInput = document.createElement('input');
		searchInput.type = richPopup ? 'search' : 'text';
		searchInput.placeholder = labels.searchPlaceholder;
		searchInput.setAttribute('aria-label', labels.searchPlaceholder);
		searchInput.classList.add('msd-dropdown-search-input');

		searchContainer.appendChild(searchInput);
		listWrapper.appendChild(searchContainer);

		const handleSearchInput = () => {
			const searchText = searchInput.value.trim();
			renderList(searchText);
			scheduleRemoteSearch(searchText);
		};
		searchInput.addEventListener('input', handleSearchInput);
		searchInput.addEventListener('search', handleSearchInput);
		searchInput.addEventListener('keydown', (event) => {
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
	trigger.setAttribute('aria-haspopup', richPopup ? 'dialog' : 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.setAttribute('aria-controls', triggerElement ? listWrapper.id : optionsList.id);
	if (popupTitle) optionsList.setAttribute('aria-labelledby', popupTitle.id);
	if (popupDescriptionId) optionsList.setAttribute('aria-describedby', popupDescriptionId);
	listWrapper.appendChild(optionsList);

	// --- Toggle on input click ---
	const handleTriggerClick = (e) => {
		e.stopPropagation();
		if (disabled) return;
		toggle();
	};
	const handleTriggerKeydown = (event) => {
		if (event.key === 'Escape') {
			close({ returnFocus: true, reason: 'escape' });
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (triggerElement && isOpen && event.key !== 'ArrowDown') toggle();
			else open();
		}
	};
	trigger.addEventListener('click', handleTriggerClick);
	trigger.addEventListener('keydown', handleTriggerKeydown);
	listWrapper.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close({ returnFocus: true, reason: 'escape' });
		} else if (event.key === 'Tab' && triggerElement) {
			const controls = Array.from(listWrapper.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]'))
				.filter(element => !element.disabled && !element.closest('[hidden]'));
			const tabbable = controls.filter(element => element.type !== 'radio' || element.checked
				|| !controls.some(candidate => candidate.type === 'radio' && candidate.name === element.name && candidate.checked));
			const edge = event.shiftKey ? tabbable[0] : tabbable.at(-1);
			if (event.target !== edge) return;
			event.preventDefault();
			const pageControls = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]'))
				.filter(element => !listWrapper.contains(element) && !element.disabled
					&& !element.closest('[hidden]') && element.getClientRects().length);
			const next = event.shiftKey ? trigger : pageControls[pageControls.indexOf(trigger) + 1];
			close({ reason: 'tab-out' });
			next?.focus({ preventScroll: true });
		}
	});
	const emptyStatus = document.createElement('div');
	emptyStatus.className = 'msd-no-results';
	emptyStatus.setAttribute('role', 'status');
	listWrapper.appendChild(emptyStatus);
	const optionPrinter = createMultiselectOptionPrinter({
		optionsList, emptyStatus, labels, allowExclude, singleTarget: richPopup && !allowExclude,
		getOptionState, isDisabled: () => disabled, isBlocked,
		toggleCheckboxState, setOptionStateAndSync, searchInput,
	});
	const { focusOptionAt } = optionPrinter;
	const popupController = createMultiselectPopupController({
		containerElement, anchorElement: triggerElement || inputRow, triggerElement: trigger,
		ownerElement, explicitOwner, listWrapper, minPopupWidth, richPopup, close, destroy,
	});
	function renderList(filterText = "", keepViewState = preserveViewState) {
		optionPrinter.renderList(currentOptions, filterText, keepViewState);
	}

	function updateDisplay() {
		if (triggerElement) return;
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
				parts.push(`${includeLabels.length} ${labels.selectedCountLabel}`);
			}
			if (excludeLabels.length > 0) {
				parts.push(`${excludeLabels.length} ${labels.excludedCountLabel}`);
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

	/**
	 * Replace options; preserveViewState retains query, keyed focus and list scroll for this update.
	 * preserveSearchText retains the legacy query filter; preserveSelected retains missing selected metadata.
	 */
	function setOptions(newOptions, options = {}) {
		const incomingOptions = Array.isArray(newOptions) ? newOptions : [];
		currentOptions = options.preserveSelected === true
			? mergeSelectedMultiselectOptions(currentOptions, incomingOptions, optionStates)
			: incomingOptions;
		updateDisplay();
		renderList(preserveViewState || options.preserveViewState === true || options.preserveSearchText === true
			? searchInput?.value?.trim() || "" : "", preserveViewState || options.preserveViewState === true);
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
		trigger.disabled = disabled;
		clearBtn.disabled = disabled;
		searchInput?.toggleAttribute('disabled', disabled);
		if (disabled) close();
		renderList(searchInput?.value?.trim() || "");
	}

	// An opening key on an open popup returns to search as it always has (with a fresh query unless the caller
	// preserves view state); only a closed-to-open transition runs the position start and onOpen, and starts a popup
	// that scrolls as a whole at its top.
	function open() {
		if (disabled || destroyed || !ownerElement.isConnected || !trigger.isConnected) return;
		if (!isOpen) {
			isOpen = true;
			onOpen?.();
			listWrapper.style.display = 'flex';
			trigger.setAttribute('aria-expanded', 'true');
			listWrapper.style.visibility = 'hidden';
			popupController.startPositionTracking();
			listWrapper.style.visibility = '';
			listWrapper.scrollTop = 0;
		}
		if (searchInput && !preserveViewState) searchInput.value = "";
		renderList(searchInput?.value?.trim() || "");
		optionPrinter.focusInView(searchInput || optionsList.querySelector('.msd-option'));
		scheduleRemoteSearch(searchInput?.value?.trim() || "", { immediate: true });
	}

	function close({ returnFocus = false, reason = 'programmatic' } = {}) {
		if (!isOpen) return;
		isOpen = false;
		listWrapper.style.display = 'none';
		trigger.setAttribute('aria-expanded', 'false');
		listWrapper.style.visibility = '';
		listWrapper.classList.remove('msd-dropdown-list--open-upward');
		listWrapper.style.top = '';
		listWrapper.style.bottom = '';
		popupController.stopPositionTracking();
		onClose?.({ reason });
		if (returnFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
	}

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		searchGeneration += 1;
		if (searchTimer !== null) window.clearTimeout(searchTimer);
		close({ reason: 'destroy' });
		popupController.dispose();
		trigger.removeEventListener('click', handleTriggerClick);
		trigger.removeEventListener('keydown', handleTriggerKeydown);
		trigger.removeAttribute('aria-controls');
		trigger.removeAttribute('aria-haspopup');
		listWrapper.remove();
		if (containerElement.__dropdown === instance) delete containerElement.__dropdown;
	}

	function toggle() {
		if (!isOpen) open();
		else close({ returnFocus: Boolean(triggerElement), reason: 'trigger' });
	}

	instance.setLabels = createMultiselectLabelUpdater({
		labels, input: inputEl, searchInput, clearButton: clearBtn, optionsList, emptyStatus, popupTitle, closeButton,
		updateDisplay, isDestroyed: () => destroyed,
	});
	renderList("");
	updateDisplay();
	return instance;

	function applyState(nextState) {
		optionStates = new Map();
		const normalizedState = normalizeMultiselectState(nextState);
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

	function isBlocked(value) {
		if (!selectionLimit || getOptionState(value) === 'include') return false;
		return (selectionLimit.getSelectionCount?.() ?? getValuesByState('include').length) >= selectionLimit.max;
	}

	function setOptionState(value, state) {
		if (state === 'include' && isBlocked(value)) return false;
		const normalizedValue = String(value);
		if (state === 'neutral') {
			optionStates.delete(normalizedValue);
			return true;
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
		return true;
	}

	function toggleCheckboxState(value) {
		const currentState = getOptionState(value);
		const nextState = currentState === 'include' ? 'neutral' : currentState === 'neutral' ? 'include' : 'neutral';
		setOptionStateAndSync(value, nextState);
	}

	function setOptionStateAndSync(value, state) {
		if (!setOptionState(value, state)) { renderList(searchInput?.value?.trim() || ""); return; }
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
