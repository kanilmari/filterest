<!-- Search_Result_Groups.md -->
<!-- Describes planned search ranking, information controls and result windows. -->
<!-- Connects dataset text matches, AI suggestions, other datasets and embedding administration. -->
<!-- Separates missing decisions and capabilities from the search grouping already implemented. -->

# Search Result Groups

## What it makes possible

The remaining capability in ticket #893 makes search groups easier to
understand and browse: text matches gain combined relevance ranking, one
information control explains whether this dataset uses AI search, and AI and
other-dataset results open in their own endlessly scrolling windows.
**These additions are not implemented.** The grouping and text-list behavior
already delivered by WL94 are the baseline, not future promises.

A **text group** contains every text-search match in the current dataset.
An **AI group** suggests rows from that dataset by closeness in meaning,
excluding text-group rows. **Other-dataset groups** hold results from other
datasets the person may read. A **meaning vector**, or embedding, is a stored
representation used to compare meaning; having AI search enabled and having
complete, fresh vectors for every row are different states.

## Already implemented by WL94

The following parts of #893 already exist and must be preserved:

- Group placement is current-dataset text matches first, AI suggestions next,
  and results from other datasets last.
- Every current-dataset text match can be reached through the ordinary
  listing's endless scrolling; it is not limited to the first few matches.
- The AI group excludes **all** rows matched by the text search, including
  matches on later pages, not just the text rows already loaded.
- Relevance is offered as a sort choice in every dataset, whether or not a
  search is running. This existing choice does not mean the combined text
  and meaning score described below has been implemented.
- The AI count is displayed only when above zero. This already avoids a
  zero AI count, but does not explain whether AI search is on or off.

The source evidence below verifies these boundaries. Group placement and
text-group pagination do not establish endless loading of every subsequent
group or the proposed independent windows.

## Decided but unbuilt

### Combined ranking of the text group

The text group must be ordered by a combined text and meaning score. A row
that contains the searched word and is also close in meaning must rise above
a row that mentions the word once in passing. A dataset without meaning
vectors ranks by the text score alone. Offering Relevance in the sort menu is
already built; applying this combined ranking to the ordinary text group is
still missing. The ticket does not specify a numeric weighting formula.

### One information control after all counters

Replace the AI counter with **one information control to the right of the
whole set of counters**, including the other-datasets counter. Keep it at the
right edge as counters are added; leaving the AI item in its old position
would put it in the middle once another counter follows it.

The control states whether AI search is in use for this dataset and shows the
AI result count only when it is. A dataset without meaning vectors must never
read “0 results in AI search.” Preserve the distinction between AI being off
and AI being on with no results; today's positive-count-only display does
not supply that explanation. The information control replaces the AI counter
rather than creating a second AI count alongside it.

### Browsing and independent result windows

Keep the decided order for browsing and loading more:

1. Every text-search match of the current dataset, browsable through endless
   scrolling.
2. Then the AI search results.
3. Then results from other datasets.

Endless scrolling must load whichever group is next, in that order. The text
group's endless scrolling is already built; continuation through the later
groups remains part of this target contract.

Ordinary text results need no window of their own because they are directly
under their counter. Pressing that counter **may briefly highlight the list
beneath it**; this remains optional. The AI results and the other datasets'
results must each open in their own window, and **each window must scroll
endlessly inside itself**. Existing in-page groups and bounded previews do
not meet this window requirement.

Use the current [permission model](../instructions_and_documentation/Permission_Model.md)
for every result, count and continuation. Interface text uses language keys;
controls and windows must support keyboard and touch, translated copy and
both explicit application themes over the opposite OS preference.

## Open administrator option and ticket acceptance

For administrators only, the same information control **could** show embedding
health: how many dataset rows have meaning vectors, when the vectors were last
refreshed, and whether a refresh is pending. This would distinguish “AI search
is off here” from “AI search is on but half the rows lack vectors.”

The unresolved decision is whether this is wanted in the search surface at
all, and whether it belongs in the same control or in the dataset's own
administration tools. Ticket #893's acceptance criterion is **a written
decision on the administrator's embedding-health view, recorded on workline
94**. The other requirements are decided and can be implemented in the order
recorded there. This document preserves the question; it does not make that
decision or claim the ticket's acceptance has been fulfilled.

The ticket's original observation that health was invisible must be read in
the light of the existing administrator embeddings page (change 3588f518).
That page already reports coverage, refresh information where tracked, and
pending refreshes. What remains open is exposing health through the search
control or retaining it in administration. General embeddings do not record a
refresh time; unknown health values must not be presented as zero or fresh.

## Other-dataset policy still open

Do other-dataset groups automatically run both text and AI search, or only
text search? Keep this ticket question open; the current compact preview is
not a final decision for the planned windows and endless loading.

The ticket also asked whether the AI group should hide rows already returned
by text search, observing that this follows from the combined ordering. WL94
has already implemented that exclusion independently of the still-missing
combined text-group ranking. Preserve it; it is no longer an implementation
promise or an unresolved duplicate-handling choice.

## What exists today: verified source boundary

The following references are current-code evidence for the distinction
between delivered grouping and the remaining feature.

| Current fact | Source evidence |
| --- | --- |
| Text results load from the ordinary listing before the AI stage; AI rows get a separate in-page host and supplemental groups are placed last. | [dataset_search_executor.js:579](../../frontend/core_components/filterbar/text_search/dataset_search_executor.js#L579), [dataset_search_executor.js:589](../../frontend/core_components/filterbar/text_search/dataset_search_executor.js#L589), [dataset_search_executor.js:348](../../frontend/core_components/filterbar/text_search/dataset_search_executor.js#L348), [dataset_search_executor.js:358](../../frontend/core_components/filterbar/text_search/dataset_search_executor.js#L358) |
| Text matches use the listing reload connected to endless scrolling, rather than the streamed top-few text answer. | [dataset_search_executor.js:373](../../frontend/core_components/filterbar/text_search/dataset_search_executor.js#L373) |
| The AI stream filters candidates against the complete dataset text-search condition, not only its initial page. | [intelligent_result_handler.go:224](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/intelligent_result_handler.go#L224), [get_results_text_search.go:93](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results_text_search.go#L93) |
| Relevance is an unconditional base sort option. | [sort_dropdown_builder_helpers.js:41](../../frontend/core_components/filterbar/top_row_buttons/sort_dropdown_builder_helpers.js#L41) |
| The count printer retains an AI count only above zero and otherwise removes it; it renders a text count followed by an AI count, not an on/off information control. | [results_count_printer.js:20](../../frontend/reusable_components/results_count/results_count_printer.js#L20), [results_count_printer.js:24](../../frontend/reusable_components/results_count/results_count_printer.js#L24), [results_count_printer.js:82](../../frontend/reusable_components/results_count/results_count_printer.js#L82), [results_count_printer.js:97](../../frontend/reusable_components/results_count/results_count_printer.js#L97) |
| Ordinary text relevance is ts_rank descending, then id descending; a plain numeric search first prioritizes that exact id. This text-group order has no meaning-similarity contribution. | [text_search_condition.go:41](../../backend/core_components/dynamic_table_tools/search_vectors/text_search_condition.go#L41), [text_search_condition.go:50](../../backend/core_components/dynamic_table_tools/search_vectors/text_search_condition.go#L50), [text_search_condition.go:56](../../backend/core_components/dynamic_table_tools/search_vectors/text_search_condition.go#L56) |
| The streamed AI group is capped, and the supplemental other-dataset preview consumes streamed packets but stops at three rows per dataset. These are not independently endless windows. | [intelligent_result_handler.go:229](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/intelligent_result_handler.go#L229), [supplemental_dataset_search.js:80](../../frontend/core_components/filterbar/text_search/supplemental_dataset_search.js#L80), [supplemental_dataset_search.js:97](../../frontend/core_components/filterbar/text_search/supplemental_dataset_search.js#L97) |
| The embeddings administration page mounts a health panel showing embedded/total rows, last refresh where known and pending work. | [refresh_lang_embeddings_view.js:89](../../frontend/custom_views/refresh_lang_embeddings_view.js#L89), [embedding_status_panel.js:171](../../frontend/custom_views/embedding_status_panel.js#L171), [embedding_status_panel.js:198](../../frontend/custom_views/embedding_status_panel.js#L198), [embedding_status_panel.js:213](../../frontend/custom_views/embedding_status_panel.js#L213) |
| The server health report supplies coverage, last-refresh and pending counts. General-vector refresh time and changed-since state are untracked, represented as unknown rather than zero. | [embedding_status_report.go:58](../../backend/core_components/dynamic_table_tools/ai_features/embedding_status_report.go#L58), [embedding_status_report.go:72](../../backend/core_components/dynamic_table_tools/ai_features/embedding_status_report.go#L72), [embedding_status_report.go:81](../../backend/core_components/dynamic_table_tools/ai_features/embedding_status_report.go#L81), [embedding_status_report.go:82](../../backend/core_components/dynamic_table_tools/ai_features/embedding_status_report.go#L82) |

## Verification required at implementation

- Preserve WL94's group order, full text-list endless scrolling, exclusion of
  later-page text matches from AI suggestions, always-available Relevance
  choice and existing positive-count behavior until its replacement lands.
- Prove combined text/meaning ordering with a strong word-and-meaning match
  above a passing mention, and text-only ranking without vectors.
- Prove the single information control stays to the right of **all** counters,
  explains on/off status and shows the AI count only when on; datasets without
  vectors never show the misleading zero-AI-results label.
- Prove next-group loading follows text → AI → other datasets; each of the two
  result windows opens from its corresponding control and scrolls endlessly
  inside itself. Text stays under its own counter; any optional counter
  highlight is brief and targets that list.
- Record the administrator health decision on WL94. If the option is chosen,
  verify administrator-only visibility, coverage, known/unknown refresh times
  and pending refreshes; retain unknown states honestly.
- Resolve and record the other-dataset text/AI policy before claiming that
  behavior, then verify it with permissions, translations and both themes.
