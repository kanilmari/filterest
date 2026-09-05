// multiselect_dropdown_data.js
// Normalizes multiselect state and searchable option data outside the DOM builder.
// Bridges stable caller values with the reusable dropdown's rendering state.
// Exists to keep the component builder focused and below the source-size guardrail.

export function normalizeMultiselectState(nextState) {
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

	return { includeValues, excludeValues };
}

export function ariaCheckedValueForMultiselectState(state) {
	if (state === 'include') return 'true';
	if (state === 'exclude') return 'mixed';
	return 'false';
}

export function normalizeMultiselectSearchText(value) {
	return String(value ?? "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase();
}

// Option labels stay concise while searchTerms can contain stable IDs and
// secondary metadata. Callers decide which fields are safe to expose.
export function searchableMultiselectOptionText(option) {
	const searchTerms = Array.isArray(option?.searchTerms) ? option.searchTerms : [];
	return normalizeMultiselectSearchText([
		option?.label,
		option?.value,
		option?.groupLabel,
		...searchTerms,
	].filter(Boolean).join(" "));
}

export function mergeSelectedMultiselectOptions(currentOptions, incomingOptions, optionStates) {
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
