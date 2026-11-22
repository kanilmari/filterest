// item_label_rename.go
// Gives a renamed folder or dataset the language key of its new name and moves only its own source.
// Between the tree and cell-edit rename paths and both translation stores, inside the caller's transaction.
// Exists so a rename never rewrites a key other items share and never drops a language it was not given.
package lang

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
)

// ErrInvalidItemLabelRename marks a request refused before anything is written; callers answer 400.
var ErrInvalidItemLabelRename = errors.New("invalid item label rename")

// ErrItemLabelConflict marks typed text for the item's own key that would replace a text the dialog
// did not show (it changed meanwhile, or lives only in the normalized row); callers answer 409.
// Nothing has been written when it is returned.
var ErrItemLabelConflict = errors.New("item label conflict")

// renameLabelLanguages are the languages a rename may write: the rename dialog's contract, each
// mirrored 1:1 between its legacy column and one normalized row. Other languages are maintained in
// language-key maintenance, where one value may deliberately fan out to several locales.
var renameLabelLanguages = []string{"fi", "en", "ch"}

// ItemLabelRename describes one renamed item and the label text typed for it.
type ItemLabelRename struct {
	// SourceType is "table" or "folder": the source row the item owns on its key.
	SourceType string
	OldKey     string
	NewKey     string
	// Translations is the typed text by language (fi, en, ch). Blank means "leave as is".
	Translations map[string]string
	// Shown is the text the dialog displayed when it opened, by language. A language present here
	// counts as edited only when its typed text differs, and the key must still show this text.
	Shown map[string]string
	// KeepOldSource is set when another item still has the old name (folders may share a name),
	// so the old key keeps that shared source row.
	KeepOldSource bool
}

type translationRow struct {
	translation  string
	sourceKind   string
	reviewStatus string
}

// keyLanguageState is one key's text in both stores, read under a row lock.
type keyLanguageState struct {
	id           int64
	columns      map[string]string
	rows         map[string]translationRow
	langKeyType  sql.NullInt64
	creationSpec sql.NullString
}

// itemLabelPlan is everything a rename writes to the destination key, decided before any write.
type itemLabelPlan struct {
	fillColumns      map[string]string
	copyRows         map[string]translationRow
	fillLangKeyType  sql.NullInt64
	fillCreationSpec sql.NullString
	edits            langKeyUpdateRequest
	keptLanguages    []string
}

// ItemLabelOutcome tells the caller what the person should know about the label after a rename.
type ItemLabelOutcome struct {
	// LangKey is the key the item's label now uses.
	LangKey string
	// KeptLanguages lists typed languages that were not saved because a key of the new name
	// already existed with other text: the name uses that key's text, which is shared.
	KeptLanguages []string
}

// MoveRenamedItemLabel gives the renamed item the key of its new name (K357).
// The old key, its text in both stores and its other sources stay as they are: another item, a
// column or code may still use it, and the orphan marking records it once nothing does. A key
// created now starts as a copy of every language of the old key, with provenance; typed text is
// then written to it, and to the item's own key on a same-name rename, through the
// language-maintenance writer. A key that already exists under the new name is shared and is never
// written by the dialog's text (owner, 22.11.2026: "Älä muuta jaettua avainta"): it keeps all it
// shows, receives only languages it shows in neither store from the old key, and the outcome lists
// the typed languages it did not save, so the person is told instead of the text vanishing.
func MoveRenamedItemLabel(tx *sql.Tx, rename ItemLabelRename) (ItemLabelOutcome, error) {
	outcome := ItemLabelOutcome{LangKey: rename.NewKey}
	if err := moveRenamedItemLabel(tx, rename, &outcome); err != nil {
		return ItemLabelOutcome{}, err
	}
	return outcome, nil
}

func moveRenamedItemLabel(tx *sql.Tx, rename ItemLabelRename, outcome *ItemLabelOutcome) error {
	if err := validateItemLabelRename(rename); err != nil {
		return err
	}

	var old, dest *keyLanguageState
	var err error
	if rename.OldKey == rename.NewKey {
		if dest, err = readKeyLanguageState(tx, rename.NewKey); err != nil {
			return err
		}
	} else {
		// Lock both keys in name order so two crossing renames cannot deadlock each other.
		first, second := rename.OldKey, rename.NewKey
		if second < first {
			first, second = second, first
		}
		states := map[string]*keyLanguageState{}
		for _, key := range []string{first, second} {
			if states[key], err = readKeyLanguageState(tx, key); err != nil {
				return err
			}
		}
		old, dest = states[rename.OldKey], states[rename.NewKey]
	}

	destIsItemsOwn := rename.OldKey == rename.NewKey || dest == nil
	if dest == nil {
		// The new name has no key yet: it starts empty and receives every language of the old one.
		dest = &keyLanguageState{columns: map[string]string{}, rows: map[string]translationRow{}}
	}
	plan, err := planItemLabelRename(rename, old, dest, destIsItemsOwn)
	if err != nil {
		return err
	}
	outcome.KeptLanguages = plan.keptLanguages

	if dest.id == 0 {
		if dest.id, err = createEmptyLangKey(tx, rename.NewKey); err != nil {
			return err
		}
	}
	if err := applyItemLabelPlan(tx, dest.id, plan); err != nil {
		return err
	}
	if old != nil && !rename.KeepOldSource && rename.OldKey != rename.NewKey {
		if err := moveItemLabelSource(tx, old.id, dest.id, rename); err != nil {
			return err
		}
	}
	return ensureItemLabelSource(tx, dest.id, rename.SourceType, rename.NewKey)
}

func validateItemLabelRename(rename ItemLabelRename) error {
	if rename.SourceType != "table" && rename.SourceType != "folder" {
		return fmt.Errorf("%w: item type %q", ErrInvalidItemLabelRename, rename.SourceType)
	}
	if strings.TrimSpace(rename.OldKey) == "" || strings.TrimSpace(rename.NewKey) == "" {
		return fmt.Errorf("%w: missing name", ErrInvalidItemLabelRename)
	}
	var unsupported []string
	for _, languages := range []map[string]string{rename.Translations, rename.Shown} {
		for code := range languages {
			if !slices.Contains(renameLabelLanguages, code) {
				unsupported = append(unsupported, code)
			}
		}
	}
	if len(unsupported) > 0 {
		sort.Strings(unsupported)
		return fmt.Errorf("%w: unsupported languages %s; a rename writes fi, en and ch, other languages are edited in language-key maintenance",
			ErrInvalidItemLabelRename, strings.Join(unsupported, ", "))
	}
	return nil
}

// planItemLabelRename decides the destination's gap fill and typed edits from both keys' state.
// destIsItemsOwn is true when the destination is the item's current key or is created now.
func planItemLabelRename(rename ItemLabelRename, old, dest *keyLanguageState, destIsItemsOwn bool) (itemLabelPlan, error) {
	plan := itemLabelPlan{fillColumns: map[string]string{}, copyRows: map[string]translationRow{}}
	merged := dest.clone()
	if old != nil && rename.OldKey != rename.NewKey {
		mirrored := map[string]bool{}
		for _, mirror := range legacyLanguageMirrors {
			for _, code := range mirror.languageCodes {
				mirrored[code] = true
			}
			if dest.showsLanguageGroup(mirror) {
				continue
			}
			// The destination shows this language in neither store: take the old key's column
			// and the rows that mirror it, exactly as they are.
			if value := old.columns[mirror.column]; strings.TrimSpace(value) != "" {
				plan.fillColumns[mirror.column] = value
				merged.columns[mirror.column] = value
			}
			for _, code := range mirror.languageCodes {
				if row, ok := old.rows[code]; ok {
					plan.copyRows[code] = row
					merged.rows[code] = row
				}
			}
		}
		for code, row := range old.rows {
			if mirrored[code] {
				continue
			}
			if _, exists := dest.rows[code]; !exists {
				plan.copyRows[code] = row
				merged.rows[code] = row
			}
		}
		if !dest.langKeyType.Valid && old.langKeyType.Valid {
			plan.fillLangKeyType = old.langKeyType
		}
		// The creation note keeps a dataset-derived label private until its source shows it.
		if strings.TrimSpace(dest.creationSpec.String) == "" && strings.TrimSpace(old.creationSpec.String) != "" {
			plan.fillCreationSpec = old.creationSpec
		}
	}

	plan.edits = langKeyUpdateRequest{LangKey: rename.NewKey}
	targets := map[string]**string{"fi": &plan.edits.Fi, "en": &plan.edits.En, "ch": &plan.edits.Ch}
	var conflicts []string
	for _, code := range renameLabelLanguages {
		typed := strings.TrimSpace(rename.Translations[code])
		if typed == "" {
			continue // blank means "no change"
		}
		if !destIsItemsOwn {
			// A key already exists under the new name: it is shared, so typed text never reaches
			// it. The name shows the key's text, gap-filled above from the old key; a typed
			// language that differs from it is reported, also when it was an untouched prefill,
			// because the label then reads differently from what the dialog showed.
			if strings.TrimSpace(merged.shownText(code)) != typed {
				plan.keptLanguages = append(plan.keptLanguages, code)
			}
			continue
		}
		shown, dialogShowedIt := rename.Shown[code]
		shown = strings.TrimSpace(shown)
		if dialogShowedIt && typed == shown {
			continue // left as the dialog showed it: not an edit
		}
		// The item's own key, or one created now from the old key: the dialog showed its text.
		current := strings.TrimSpace(merged.shownText(code))
		if current == typed {
			continue
		}
		// The key's text in either store must still be what the dialog showed. The dialog reads
		// only the legacy column, so a text kept only in the normalized row is refused too:
		// nobody saw it, and the typed text would replace it.
		if dialogShowedIt && current != shown {
			conflicts = append(conflicts, fmt.Sprintf("%s no longer matches what the dialog showed", code))
			continue
		}
		text := typed
		*targets[code] = &text
	}
	if len(conflicts) > 0 {
		return itemLabelPlan{}, fmt.Errorf("%w: language key %q: %s; change the text in language-key maintenance or choose another name",
			ErrItemLabelConflict, rename.NewKey, strings.Join(conflicts, "; "))
	}
	return plan, nil
}

func (state *keyLanguageState) clone() *keyLanguageState {
	copied := &keyLanguageState{id: state.id, columns: map[string]string{}, rows: map[string]translationRow{},
		langKeyType: state.langKeyType, creationSpec: state.creationSpec}
	for column, value := range state.columns {
		copied.columns[column] = value
	}
	for code, row := range state.rows {
		copied.rows[code] = row
	}
	return copied
}

// showsLanguageGroup is true when the key has text for the column in either store.
func (state *keyLanguageState) showsLanguageGroup(mirror legacyLanguageMirror) bool {
	if strings.TrimSpace(state.columns[mirror.column]) != "" {
		return true
	}
	for _, code := range mirror.languageCodes {
		if strings.TrimSpace(state.rows[code].translation) != "" {
			return true
		}
	}
	return false
}

// shownText is the key's text for one legacy column: the column, else its first mirrored row,
// the same order in which the interface is served.
func (state *keyLanguageState) shownText(column string) string {
	if value := state.columns[column]; strings.TrimSpace(value) != "" {
		return value
	}
	for _, mirror := range legacyLanguageMirrors {
		if mirror.column != column {
			continue
		}
		for _, code := range mirror.languageCodes {
			if row, ok := state.rows[code]; ok && strings.TrimSpace(row.translation) != "" {
				return row.translation
			}
		}
	}
	return ""
}

// readKeyLanguageState locks the key and reads both stores, or returns nil when it does not exist.
func readKeyLanguageState(tx *sql.Tx, langKey string) (*keyLanguageState, error) {
	state := &keyLanguageState{columns: map[string]string{}, rows: map[string]translationRow{}}
	var fi, en, ch, yue sql.NullString
	err := tx.QueryRow(`
		SELECT id, fi, en, ch, yue, lang_key_type, creation_spec
		FROM system_lang_keys
		WHERE lang_key = $1
		FOR UPDATE
	`, langKey).Scan(&state.id, &fi, &en, &ch, &yue, &state.langKeyType, &state.creationSpec)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read language key %q: %w", langKey, err)
	}
	for column, value := range map[string]sql.NullString{"fi": fi, "en": en, "ch": ch, "yue": yue} {
		if value.Valid {
			state.columns[column] = value.String
		}
	}
	// The rows are locked as well: the plan is decided from them, and a writer that changes a
	// row without first locking its key must wait until this rename has committed.
	rows, err := tx.Query(`
		SELECT language_code, translation, source_kind, review_status
		FROM system_lang_key_translations
		WHERE lang_key_id = $1
		FOR UPDATE
	`, state.id)
	if err != nil {
		return nil, fmt.Errorf("read languages of key %q: %w", langKey, err)
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var row translationRow
		if err := rows.Scan(&code, &row.translation, &row.sourceKind, &row.reviewStatus); err != nil {
			return nil, fmt.Errorf("read languages of key %q: %w", langKey, err)
		}
		state.rows[code] = row
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read languages of key %q: %w", langKey, err)
	}
	return state, nil
}

// createEmptyLangKey creates the key of a new name; the plan then fills it.
func createEmptyLangKey(tx *sql.Tx, langKey string) (int64, error) {
	var id int64
	if err := tx.QueryRow(`
		INSERT INTO system_lang_keys (lang_key, created, updated)
		VALUES ($1, NOW(), NOW())
		RETURNING id
	`, langKey).Scan(&id); err != nil {
		return 0, fmt.Errorf("create language key %q: %w", langKey, err)
	}
	return id, nil
}

// applyItemLabelPlan writes the gap fill, then the typed edits through the maintenance writer.
func applyItemLabelPlan(tx *sql.Tx, destID int64, plan itemLabelPlan) error {
	if len(plan.fillColumns) > 0 || plan.fillLangKeyType.Valid || plan.fillCreationSpec.Valid {
		value := func(column string) sql.NullString {
			text, ok := plan.fillColumns[column]
			return sql.NullString{String: text, Valid: ok}
		}
		if _, err := tx.Exec(`
			UPDATE system_lang_keys
			SET fi = COALESCE($2, fi),
			    en = COALESCE($3, en),
			    ch = COALESCE($4, ch),
			    yue = COALESCE($5, yue),
			    lang_key_type = COALESCE(lang_key_type, $6),
			    creation_spec = CASE WHEN $7::text IS NULL THEN creation_spec
			                         ELSE COALESCE(NULLIF(BTRIM(creation_spec), ''), $7::text) END,
			    updated = NOW()
			WHERE id = $1
		`, destID, value("fi"), value("en"), value("ch"), value("yue"), plan.fillLangKeyType, plan.fillCreationSpec); err != nil {
			return fmt.Errorf("fill label languages: %w", err)
		}
	}
	codes := make([]string, 0, len(plan.copyRows))
	for code := range plan.copyRows {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		row := plan.copyRows[code]
		if _, err := tx.Exec(`
			INSERT INTO system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (lang_key_id, language_code) DO NOTHING
		`, destID, code, row.translation, row.sourceKind, row.reviewStatus); err != nil {
			return fmt.Errorf("copy label language %s: %w", code, err)
		}
	}
	if plan.edits.Fi == nil && plan.edits.En == nil && plan.edits.Ch == nil {
		return nil
	}
	if _, err := writeLangKeyTranslations(tx, plan.edits); err != nil {
		return fmt.Errorf("write label text: %w", err)
	}
	return nil
}

// moveItemLabelSource moves the renamed item's own source row from the old key to the new one.
// Its usage explanation travels with it; the source-rename helpers then rewrite the name in it.
func moveItemLabelSource(tx *sql.Tx, oldID, newID int64, rename ItemLabelRename) error {
	if _, err := tx.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
		SELECT $1, source_type, $2, $2, usage_explanation, CURRENT_DATE
		FROM system_lang_key_sources
		WHERE lang_key_id = $3 AND source_type = $4 AND source_high = $5
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		SET source_low = EXCLUDED.source_low,
		    usage_explanation = COALESCE(NULLIF(system_lang_key_sources.usage_explanation, ''), EXCLUDED.usage_explanation),
		    last_seen = CURRENT_DATE
	`, newID, rename.NewKey, oldID, rename.SourceType, rename.OldKey); err != nil {
		return fmt.Errorf("move %s label source: %w", rename.SourceType, err)
	}
	if _, err := tx.Exec(`
		DELETE FROM system_lang_key_sources
		WHERE lang_key_id = $1 AND source_type = $2 AND source_high = $3
	`, oldID, rename.SourceType, rename.OldKey); err != nil {
		return fmt.Errorf("release old %s label source: %w", rename.SourceType, err)
	}
	return nil
}

// ensureItemLabelSource records that the item uses the key, so its label is never left unbound.
func ensureItemLabelSource(tx *sql.Tx, langKeyID int64, sourceType, name string) error {
	if langKeyID == 0 {
		return fmt.Errorf("missing language key identity")
	}
	if _, err := tx.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		VALUES ($1, $2, $3, $3, CURRENT_DATE)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		SET source_low = EXCLUDED.source_low,
		    last_seen = CURRENT_DATE
	`, langKeyID, sourceType, name); err != nil {
		return fmt.Errorf("associate language key with %s: %w", sourceType, err)
	}
	return nil
}
