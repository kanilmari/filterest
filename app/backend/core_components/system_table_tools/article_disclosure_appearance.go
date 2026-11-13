// article_disclosure_appearance.go
// Adapts article defaults to the single WL160 site-default and dataset-override owner.
// Existing article editors keep their authorized API; opening a block never calls it.
// Sparse overrides preserve inheritance and explicit false values through every writer.
package system_table_tools

import (
	"database/sql"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	appearance "easelect/frontend/shared/dataset_appearance"
)

func articleDisclosurePath(presentation, block string) string {
	return "shared." + canonicalArticleSectionKey(presentation) + "_" + block + "_initial_open"
}

func articleBlocksFromAppearance(snapshot store.AppearanceResponse) map[string]map[string]bool {
	values := store.ValuesForPlace(snapshot.Effective, appearance.SiteDefault)
	result := map[string]map[string]bool{}
	for _, presentation := range articlePresentationKeys {
		result[presentation] = map[string]bool{}
		for _, block := range articleSupportedSections(presentation) {
			result[presentation][block], _ = values[articleDisclosurePath(presentation, block)].(bool)
		}
	}
	return result
}

func articleDefaultsFromAppearance(dataset, presentation string, snapshot store.AppearanceResponse, canEdit bool) ArticleSectionDefaultsResponse {
	blocks := articleBlocksFromAppearance(snapshot)
	result := ArticleSectionDefaultsResponse{Dataset: dataset, PresentationKey: presentation,
		SupportedSections: articleSupportedSections(presentation), Overrides: map[string]bool{},
		InitialOpen: blocks[canonicalArticleSectionKey(presentation)], CanEdit: canEdit}
	for _, block := range result.SupportedSections {
		if value, exists := snapshot.Overrides[articleDisclosurePath(presentation, block)]; exists {
			result.Overrides[block] = value.(bool)
		}
	}
	return result
}

// Match the appearance writer's lock order before an article editor locks the registry.
// Without this order, a simultaneous palette save can deadlock on its UID lock.
func lockArticleAppearance(tx *sql.Tx, uid int) error {
	if err := store.LockShared(tx, false); err != nil {
		return err
	}
	_, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('dataset_appearance:' || $1::text,0))`, uid)
	return err
}

func readArticleSectionAppearance(q dbutils.Querier, uid int) (store.AppearanceResponse, error) {
	// Stored development-only visual values remain valid; only booleans leave this adapter.
	return store.ReadAppearance(q, uid, true)
}

func persistArticleSectionDefaults(tx *sql.Tx, tableUID int, input articleSectionDefaultsPatch) (ArticleSectionDefaultsResponse, error) {
	if err := lockArticleAppearance(tx, tableUID); err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	snapshot, err := readArticleSectionAppearance(tx, tableUID)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	patch := store.DatasetAppearancePatch{Set: map[string]any{}}
	if input.ResetToDefaults {
		for _, block := range articleSupportedSections(input.PresentationKey) {
			patch.Unset = append(patch.Unset, articleDisclosurePath(input.PresentationKey, block))
		}
	} else {
		for block, value := range input.InitialOpen {
			patch.Set[articleDisclosurePath(input.PresentationKey, block)] = value
		}
	}
	if _, err = store.SaveDatasetAppearance(tx, tableUID, patch, snapshot.Version, snapshot.SharedVersion, true); err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	snapshot, err = readArticleSectionAppearance(tx, tableUID)
	if err != nil {
		return ArticleSectionDefaultsResponse{}, err
	}
	return articleDefaultsFromAppearance(input.Dataset, input.PresentationKey, snapshot, true), err
}

// A complete editor payload does not turn all inherited values into explicit overrides.
func changedArticleBlocks(input, baseline articleBlocks) store.DatasetAppearancePatch {
	patch := store.DatasetAppearancePatch{Set: map[string]any{}}
	for presentation, blocks := range input {
		for block, value := range blocks {
			if previous, exists := baseline[presentation][block]; !exists || value != previous {
				patch.Set[articleDisclosurePath(presentation, block)] = value
			}
		}
	}
	return patch
}

func persistChangedArticleBlocks(tx *sql.Tx, uid int, input, baseline articleBlocks) error {
	patch := changedArticleBlocks(input, baseline)
	if len(patch.Set) == 0 {
		return nil
	}
	snapshot, err := readArticleSectionAppearance(tx, uid)
	if err != nil {
		return err
	}
	_, err = store.SaveDatasetAppearance(tx, uid, patch, snapshot.Version, snapshot.SharedVersion, true)
	return err
}
