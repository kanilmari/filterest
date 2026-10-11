// dataset_kind_metadata_reader.go
// Adds the same structural capability contract to authorized dataset responses.
// Metadata remains separate from row/column rights and mutable view defaults.
// Optional evidence failures preserve readable rows and the previous response shape.
package dtt_1_row_read

import (
	"context"
	"log"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds"
)

func readDatasetKindCapabilities(ctx context.Context, name string) *dataset_kinds.Capabilities {
	if backend.Db == nil {
		return nil
	}
	capabilities, err := dataset_kinds.ReadForName(ctx, backend.Db, name)
	if err != nil {
		log.Printf("\033[31merror: optional dataset kind evidence: %v\033[0m", err)
		return nil
	}
	return &capabilities
}

func addDatasetKindCapabilities(ctx context.Context, name string, response map[string]interface{}) {
	if capabilities := readDatasetKindCapabilities(ctx, name); capabilities != nil {
		response["kind_capabilities"] = capabilities
	}
}

// Related appearance has already proved the ordinary read permission and
// pinned each authorized dataset UID. Never disclose capabilities for a
// related-only reader whose ordinary dataset metadata is unavailable.
func populateRelatedKindCapabilities(ctx context.Context, results []RelatedTableResult) {
	uids := []int64{}
	seen := make(map[int]bool)
	for _, result := range results {
		if result.DatasetUID > 0 && !seen[result.DatasetUID] {
			seen[result.DatasetUID] = true
			uids = append(uids, int64(result.DatasetUID))
		}
	}
	if len(uids) == 0 || backend.Db == nil {
		return
	}
	snapshot, err := dataset_kinds.ReadSnapshot(ctx, backend.Db, uids...)
	if err != nil {
		log.Printf("\033[31merror: optional related dataset kind evidence: %v\033[0m", err)
		return
	}
	byUID := make(map[int]dataset_kinds.Capabilities, len(uids))
	for i := range results {
		if results[i].DatasetUID <= 0 {
			continue
		}
		capabilities, found := byUID[results[i].DatasetUID]
		if !found {
			capabilities = dataset_kinds.ResolveCached(snapshot, int64(results[i].DatasetUID))
			byUID[results[i].DatasetUID] = capabilities
		}
		results[i].KindCapabilities = &capabilities
	}
}
