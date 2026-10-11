// dataset_alias_reader.go
// Resolves public dataset URL aliases to raw internal table names and back.
// Bridges inbound router/SEO paths with canonical system_db_tables.table_name values.
// Exists to centralize the temporary dataset alias rollout inside the router package.
package router

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
)

// resolveRawDatasetName maps a public alias or raw dataset name to the raw table name.
func resolveRawDatasetName(datasetName string) string {
	return dataset_routes.ResolveRawDatasetNameWithQuerier(backend.Db, datasetName)
}

// resolvePublicDatasetName maps a raw dataset name to its public alias when one exists.
func resolvePublicDatasetName(datasetName string) string {
	return dataset_routes.ResolvePublicDatasetNameWithQuerier(backend.Db, datasetName)
}

// resolveDocumentDataset keeps the accepted public-schema pool, including its UID,
// through document metadata and authorization. A raw-name fallback cannot establish
// an identity when the registry read failed or only an unsupported schema owns it.
func resolveDocumentDataset(name string) (dataset_routes.DatasetNamePool, bool) {
	if name == "" || backend.Db == nil {
		return dataset_routes.DatasetNamePool{}, false
	}
	pools, err := dataset_routes.LoadDatasetNamePools(backend.Db)
	if err != nil {
		return dataset_routes.DatasetNamePool{}, false
	}
	for _, pool := range pools {
		if pool.SchemaName != "public" || pool.TableUID <= 0 {
			continue
		}
		for _, accepted := range pool.Names {
			if accepted == name && backend.ShouldExposeCloudManagementDatasetName(pool.DatasetName) {
				return pool, true
			}
		}
	}
	return dataset_routes.DatasetNamePool{}, false
}
