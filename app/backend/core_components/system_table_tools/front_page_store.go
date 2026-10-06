// front_page_store.go
// Resolves saved scopes and the computed project-menu default for the front page.
// Connects stable dataset identities with the existing project query and route rights.
// Keeps account overrides whole, including a deliberately disabled list.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_visibility"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/pipeline/access_control"
)

type frontPageBlock struct {
	ID          int64  `json:"id,omitempty"`
	Dataset     string `json:"dataset"`
	ResultLimit int    `json:"result_limit"`
	SortOrder   int    `json:"sort_order"`
	Enabled     bool   `json:"enabled"`
	CanRead     bool   `json:"can_read"`
}

type frontPageDataset struct {
	Dataset       string `json:"dataset"`
	NewestCapable bool   `json:"newest_capable"`
	CanRead       bool   `json:"can_read"`
	TopLevel      bool   `json:"-"`
	Main          bool   `json:"-"`
}

func readFrontPageBlocks(q dbutils.Querier, scope int) ([]frontPageBlock, error) {
	rows, err := q.Query(`SELECT block.id, registry.table_name, block.result_limit, block.sort_order, block.enabled
        FROM public.system_front_page_blocks block JOIN public.system_db_tables registry USING (table_uid)
        WHERE block.user_id IS NOT DISTINCT FROM NULLIF($1, 0)::bigint
        ORDER BY block.sort_order, block.id`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	blocks := []frontPageBlock{}
	for rows.Next() {
		var block frontPageBlock
		if err := rows.Scan(&block.ID, &block.Dataset, &block.ResultLimit, &block.SortOrder, &block.Enabled); err != nil {
			return nil, err
		}
		blocks = append(blocks, block)
	}
	return blocks, rows.Err()
}

func frontPageDatasetReadable(userID int, dataset string) bool {
	if !backend.ShouldExposeCloudManagementDatasetName(dataset) ||
		!access_control.UserHasFunctionPermissionOnTableQuiet(userID, "/api/get-results", dataset, "") {
		return false
	}
	hidden, err := dataset_visibility.HiddenForUser(backend.Db, dataset, userID)
	return err == nil && !hidden
}

// readFrontPageDatasets extends the existing grouped project query, without a second menu definition.
func readFrontPageDatasets(q dbutils.Querier, userID int) ([]frontPageDataset, error) {
	rows, err := q.Query(`SELECT grouped.table_name, grouped.is_top_level_in_current_project,
        COALESCE(grouped.is_main_table, false), EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public' AND col.table_name = grouped.table_name
              AND col.column_name IN ('created', 'created_at', 'applied_at', 'id'))
        FROM (` + buildGroupedTablesQuery("NULL::varchar AS icon_key") + `) grouped
        JOIN public.system_db_tables registry USING (table_uid)
        WHERE COALESCE(NULLIF(registry.schema_name, ''), 'public') = 'public'
          AND public.app_row_actor_side_table_reason(grouped.table_name) IS NULL
          AND grouped.table_name NOT IN ('system_users', 'system_about')
        ORDER BY grouped.table_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	datasets := []frontPageDataset{}
	for rows.Next() {
		var dataset frontPageDataset
		if err := rows.Scan(&dataset.Dataset, &dataset.TopLevel, &dataset.Main, &dataset.NewestCapable); err != nil {
			return nil, err
		}
		if backend.ShouldExposeCloudManagementDatasetName(dataset.Dataset) {
			datasets = append(datasets, dataset)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Close the catalogue cursor before permission reads; a one-connection pool is valid.
	rows.Close()
	for index := range datasets {
		datasets[index].CanRead = frontPageCanRead(userID, datasets[index].Dataset)
	}
	return datasets, nil
}

func defaultFrontPageBlocks(q dbutils.Querier, userID int) ([]frontPageBlock, error) {
	datasets, err := readFrontPageDatasets(q, userID)
	if err != nil {
		return nil, err
	}
	var raw []byte
	err = q.QueryRow(`SELECT tab_order_json FROM public.system_table_folders
        WHERE is_current_project = true ORDER BY id LIMIT 1`).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var order []struct {
		TabID     string `json:"tab_id"`
		Dataset   string `json:"dataset_name"`
		SortOrder int    `json:"sort_order"`
	}
	_ = json.Unmarshal(raw, &order)
	positions := map[string]int{}
	for _, entry := range order {
		name := entry.TabID
		if name == "" {
			name = entry.Dataset
		}
		if _, exists := positions[name]; !exists {
			positions[name] = entry.SortOrder
		}
	}
	// Same fallback as the main tabs: main dataset first, then dataset names.
	sort.SliceStable(datasets, func(i, j int) bool {
		left, lok := positions[datasets[i].Dataset]
		right, rok := positions[datasets[j].Dataset]
		if lok != rok {
			return lok
		}
		if lok && left != right {
			return left < right
		}
		if datasets[i].Main != datasets[j].Main {
			return datasets[i].Main
		}
		return datasets[i].Dataset < datasets[j].Dataset
	})
	blocks := []frontPageBlock{}
	for _, dataset := range datasets {
		if !dataset.TopLevel || !dataset.NewestCapable || !dataset.CanRead {
			continue
		}
		blocks = append(blocks, frontPageBlock{Dataset: dataset.Dataset, ResultLimit: 5,
			SortOrder: len(blocks) + 1, Enabled: true, CanRead: true})
		if len(blocks) == 12 {
			break
		}
	}
	return blocks, nil
}

func resolveFrontPageBlocks(q dbutils.Querier, userID int) ([]frontPageBlock, string, error) {
	if userID > 1 {
		blocks, err := readFrontPageBlocks(q, userID)
		if err != nil || len(blocks) > 0 {
			return blocks, "user", err
		}
	}
	blocks, err := readFrontPageBlocks(q, 0)
	if err != nil || len(blocks) > 0 {
		return blocks, "common", err
	}
	blocks, err = defaultFrontPageBlocks(q, userID)
	return blocks, "default", err
}
