// missing_media_budget_planner.go
// Splits one bounded row budget across the datasets that reference media files.
// Between the administrator's total work limit and the per-dataset sampling queries.
// Exists so a large installation is sampled in proportion to dataset size instead of
// scanning every row, while small datasets are still checked completely.
package missing_media_check

import "sort"

// DatasetRowCount is one dataset's total number of media-referencing rows.
type DatasetRowCount struct {
	Dataset    string `json:"dataset"`
	AssetTable string `json:"asset_table"`
	RowCount   int    `json:"row_count"`
}

// DatasetBudget is how many rows of one dataset the check is allowed to read.
type DatasetBudget struct {
	Dataset     string `json:"dataset"`
	AssetTable  string `json:"asset_table"`
	RowCount    int    `json:"row_count"`
	PlannedRows int    `json:"planned_rows"`
	Complete    bool   `json:"complete"`
}

// BudgetPlan is the whole allocation, plus the honesty flags the report needs.
// DatasetsExceedBudget marks the case the owner asked to be stated out loud:
// there are more datasets than the budget has rows, so some dataset cannot be
// reached at all and the run must say so rather than look complete.
type BudgetPlan struct {
	Datasets             []DatasetBudget `json:"datasets"`
	PlannedRows          int             `json:"planned_rows"`
	TotalRows            int             `json:"total_rows"`
	DatasetsExceedBudget bool            `json:"datasets_exceed_budget"`
	UncheckedDatasets    int             `json:"unchecked_datasets"`
	MinimumPerDatasetMet bool            `json:"minimum_per_dataset_met"`
}

// PlanRowBudget divides maxTotalRows between datasets in proportion to their size.
//
// The proportional share is the primary rule: 90 000 and 10 000 rows sharing a
// 10 000-row budget become 9 000 and 1 000. A dataset whose proportional share
// would fall below minRowsPerDataset is raised to min(its size, that floor), so a
// handful of rows in a small dataset are always all checked; the rows for that
// are trimmed off the largest allocations. When every dataset fits inside the
// budget, every dataset is checked completely.
func PlanRowBudget(counts []DatasetRowCount, maxTotalRows int, minRowsPerDataset int) BudgetPlan {
	plan := BudgetPlan{Datasets: []DatasetBudget{}, MinimumPerDatasetMet: true}

	eligible := make([]DatasetRowCount, 0, len(counts))
	for _, count := range counts {
		if count.RowCount <= 0 {
			continue
		}
		plan.TotalRows += count.RowCount
		eligible = append(eligible, count)
	}
	// Largest first keeps the trimming and the "which datasets fit" decision
	// deterministic, and puts the datasets most likely to hide a problem first.
	sort.SliceStable(eligible, func(first, second int) bool {
		if eligible[first].RowCount != eligible[second].RowCount {
			return eligible[first].RowCount > eligible[second].RowCount
		}
		return eligible[first].Dataset < eligible[second].Dataset
	})

	if len(eligible) == 0 {
		return plan
	}
	if minRowsPerDataset < 1 {
		minRowsPerDataset = 1
	}

	if maxTotalRows <= 0 || len(eligible) > maxTotalRows {
		plan.DatasetsExceedBudget = true
		plan.MinimumPerDatasetMet = false
		reachable := maxTotalRows
		if reachable < 0 {
			reachable = 0
		}
		for index, dataset := range eligible {
			planned := 0
			if index < reachable {
				planned = 1
			}
			plan.Datasets = append(plan.Datasets, newDatasetBudget(dataset, planned))
			plan.PlannedRows += planned
		}
		plan.UncheckedDatasets = len(eligible) - reachable
		return plan
	}

	allocations := make([]int, len(eligible))
	floors := make([]int, len(eligible))
	sizes := make([]int, len(eligible))
	totalRows := 0
	for index, dataset := range eligible {
		sizes[index] = dataset.RowCount
		totalRows += dataset.RowCount
	}

	if totalRows <= maxTotalRows {
		for index := range eligible {
			allocations[index] = sizes[index]
		}
	} else {
		for index := range eligible {
			// int64 keeps size * budget safe for multi-million-row datasets.
			proportional := int(int64(sizes[index]) * int64(maxTotalRows) / int64(totalRows))
			floor := minRowsPerDataset
			if floor > sizes[index] {
				floor = sizes[index]
			}
			floors[index] = floor
			allocations[index] = proportional
			if allocations[index] < floor {
				allocations[index] = floor
			}
			if allocations[index] > sizes[index] {
				allocations[index] = sizes[index]
			}
		}
		plan.MinimumPerDatasetMet = trimAllocationsToBudget(allocations, floors, maxTotalRows)
		growAllocationsToBudget(allocations, sizes, maxTotalRows)
	}

	for index, dataset := range eligible {
		plan.Datasets = append(plan.Datasets, newDatasetBudget(dataset, allocations[index]))
		plan.PlannedRows += allocations[index]
		if allocations[index] <= 0 {
			plan.UncheckedDatasets++
		}
	}
	return plan
}

func newDatasetBudget(dataset DatasetRowCount, plannedRows int) DatasetBudget {
	return DatasetBudget{
		Dataset:     dataset.Dataset,
		AssetTable:  dataset.AssetTable,
		RowCount:    dataset.RowCount,
		PlannedRows: plannedRows,
		Complete:    plannedRows >= dataset.RowCount,
	}
}

// trimAllocationsToBudget removes the rows that raising small datasets to their
// floor added, taking them from the largest allocations first. It reports whether
// every dataset kept its guaranteed floor; when the floors alone do not fit, they
// are lowered to one row per dataset and the caller says the minimum was not met.
func trimAllocationsToBudget(allocations, floors []int, maxTotalRows int) bool {
	minimumMet := true
	if sumOf(allocations) <= maxTotalRows {
		return minimumMet
	}
	removeDownTo(allocations, floors, maxTotalRows)
	if sumOf(allocations) <= maxTotalRows {
		return minimumMet
	}
	minimumMet = false
	singleRowFloors := make([]int, len(allocations))
	for index := range singleRowFloors {
		singleRowFloors[index] = 1
	}
	removeDownTo(allocations, singleRowFloors, maxTotalRows)
	return minimumMet
}

func removeDownTo(allocations, floors []int, maxTotalRows int) {
	excess := sumOf(allocations) - maxTotalRows
	for excess > 0 {
		capacityTotal := 0
		for index := range allocations {
			if allocations[index] > floors[index] {
				capacityTotal += allocations[index] - floors[index]
			}
		}
		if capacityTotal == 0 {
			return
		}
		if excess >= capacityTotal {
			copy(allocations, floors)
			return
		}
		removed := 0
		for index := range allocations {
			capacity := allocations[index] - floors[index]
			if capacity <= 0 {
				continue
			}
			take := int(int64(capacity) * int64(excess) / int64(capacityTotal))
			if take > capacity {
				take = capacity
			}
			allocations[index] -= take
			removed += take
		}
		if removed == 0 {
			// Rounding left less than one row per dataset to remove; take the
			// remainder from the largest allocations, one row at a time.
			for _, index := range indicesByValueDesc(allocations) {
				if excess == 0 {
					break
				}
				if allocations[index] > floors[index] {
					allocations[index]--
					excess--
					removed++
				}
			}
			if removed == 0 {
				return
			}
			continue
		}
		excess -= removed
	}
}

// growAllocationsToBudget spends rows that integer rounding left unused, giving
// them to the datasets with the largest remaining unchecked share first.
func growAllocationsToBudget(allocations, sizes []int, maxTotalRows int) {
	remaining := maxTotalRows - sumOf(allocations)
	if remaining <= 0 {
		return
	}
	headroom := make([]int, len(allocations))
	for index := range allocations {
		headroom[index] = sizes[index] - allocations[index]
	}
	for remaining > 0 {
		granted := 0
		for _, index := range indicesByValueDesc(headroom) {
			if remaining == 0 {
				break
			}
			if headroom[index] <= 0 {
				break
			}
			allocations[index]++
			headroom[index]--
			remaining--
			granted++
		}
		if granted == 0 {
			return
		}
	}
}

func sumOf(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

func indicesByValueDesc(values []int) []int {
	indices := make([]int, len(values))
	for index := range values {
		indices[index] = index
	}
	sort.SliceStable(indices, func(first, second int) bool {
		return values[indices[first]] > values[indices[second]]
	})
	return indices
}
