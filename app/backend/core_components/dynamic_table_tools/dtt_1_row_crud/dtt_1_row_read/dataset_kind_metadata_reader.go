// dataset_kind_metadata_reader.go
// Adds the same structural capability contract to authorized dataset responses.
// Metadata remains separate from row/column rights and mutable view defaults.
// Optional evidence failures preserve readable rows and the previous response shape.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"log"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds"
	"easelect/backend/core_components/dbutils"
)

type datasetKindQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// Pilot reads retain the request transaction until the pipeline finishes.
// Reuse that connection for schema-only evidence instead of waiting for another
// slot in the same bounded pool. Peek never starts an otherwise lazy transaction.
func datasetKindReadQuerier(ctx context.Context) datasetKindQuerier {
	if tx, open := dbutils.PeekTx(ctx); open {
		return tx
	}
	if backend.Db == nil {
		return nil
	}
	return backend.Db
}

func readDatasetKindCapabilities(ctx context.Context, name string) *dataset_kinds.Capabilities {
	q := datasetKindReadQuerier(ctx)
	if q == nil {
		return nil
	}
	capabilities, err := dataset_kinds.ReadForName(ctx, q, name)
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

// Canonical Home reads already have a savepoint/deadline-bound querier. Reuse
// it for the final evidence read instead of escaping through PeekTx or a pool.
// Ordinary result callers retain the existing context-aware evidence reader.
func addResultsDatasetKindCapabilities(ctx context.Context, name string, response map[string]interface{}, q dbutils.Querier) {
	if dbutils.ReadBudgetContext(ctx) == ctx {
		addDatasetKindCapabilities(ctx, name, response)
		return
	}
	capabilities, err := dataset_kinds.ReadForName(ctx, resultsKindQuerier{q}, name)
	if err != nil {
		log.Printf("\033[31merror: optional dataset kind evidence: %v\033[0m", err)
		return
	}
	response["kind_capabilities"] = capabilities
}

type resultsKindQuerier struct{ dbutils.Querier }

func (q resultsKindQuerier) QueryRowContext(_ context.Context, query string, args ...any) *sql.Row {
	return q.QueryRow(query, args...)
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
	q := datasetKindReadQuerier(ctx)
	if len(uids) == 0 || q == nil {
		return
	}
	snapshot, err := dataset_kinds.ReadSnapshot(ctx, q, uids...)
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
