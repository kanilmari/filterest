// missing_media_budget_planner_test.go
// Verifies that one bounded row budget is split the way the owner described it.
// Between the budget rule and the sampling the checker performs from it.
// Exists so a later change cannot quietly turn "a proportional sample of every
// dataset" into "the first dataset until the budget runs out".
package missing_media_check

import "testing"

func allocationByDataset(plan BudgetPlan) map[string]int {
	allocations := map[string]int{}
	for _, dataset := range plan.Datasets {
		allocations[dataset.Dataset] = dataset.PlannedRows
	}
	return allocations
}

func TestPlanRowBudgetSplitsProportionally(t *testing.T) {
	plan := PlanRowBudget([]DatasetRowCount{
		{Dataset: "large", AssetTable: "large_assets", RowCount: 90000},
		{Dataset: "small", AssetTable: "small_assets", RowCount: 10000},
	}, 10000, 50)

	allocations := allocationByDataset(plan)
	if allocations["large"] != 9000 || allocations["small"] != 1000 {
		t.Fatalf("proportional split = %v, want large 9000 and small 1000", allocations)
	}
	if plan.PlannedRows != 10000 {
		t.Fatalf("planned rows = %d, want the whole 10000-row budget", plan.PlannedRows)
	}
	if plan.TotalRows != 100000 {
		t.Fatalf("total rows = %d, want 100000", plan.TotalRows)
	}
	if plan.DatasetsExceedBudget {
		t.Fatal("two datasets never exceed a 10000-row budget")
	}
}

func TestPlanRowBudgetChecksSmallDatasetsCompletely(t *testing.T) {
	plan := PlanRowBudget([]DatasetRowCount{
		{Dataset: "large", AssetTable: "large_assets", RowCount: 90000},
		{Dataset: "medium", AssetTable: "medium_assets", RowCount: 10000},
		{Dataset: "tiny", AssetTable: "tiny_assets", RowCount: 5},
	}, 10000, 50)

	allocations := allocationByDataset(plan)
	if allocations["tiny"] != 5 {
		t.Fatalf("tiny dataset allocation = %d, want all 5 rows", allocations["tiny"])
	}
	for _, dataset := range plan.Datasets {
		if dataset.Dataset == "tiny" && !dataset.Complete {
			t.Fatal("a fully allocated dataset must be marked complete")
		}
	}
	if plan.PlannedRows != 10000 {
		t.Fatalf("planned rows = %d, want the whole budget spent", plan.PlannedRows)
	}
	if allocations["large"] <= allocations["medium"] {
		t.Fatalf("the largest dataset must keep the largest share: %v", allocations)
	}
}

func TestPlanRowBudgetChecksEverythingWhenItFits(t *testing.T) {
	plan := PlanRowBudget([]DatasetRowCount{
		{Dataset: "a", AssetTable: "a_assets", RowCount: 12},
		{Dataset: "b", AssetTable: "b_assets", RowCount: 30},
	}, 10000, 50)

	allocations := allocationByDataset(plan)
	if allocations["a"] != 12 || allocations["b"] != 30 {
		t.Fatalf("small installation allocations = %v, want every row checked", allocations)
	}
	if plan.PlannedRows != plan.TotalRows {
		t.Fatalf("planned %d of %d rows, want all of them", plan.PlannedRows, plan.TotalRows)
	}
	for _, dataset := range plan.Datasets {
		if !dataset.Complete {
			t.Fatalf("dataset %s should be complete", dataset.Dataset)
		}
	}
}

func TestPlanRowBudgetReachesTheBudgetExactly(t *testing.T) {
	plan := PlanRowBudget([]DatasetRowCount{
		{Dataset: "a", AssetTable: "a_assets", RowCount: 3333},
		{Dataset: "b", AssetTable: "b_assets", RowCount: 3333},
		{Dataset: "c", AssetTable: "c_assets", RowCount: 3334},
	}, 100, 50)

	if plan.PlannedRows != 100 {
		t.Fatalf("planned rows = %d, want exactly the 100-row budget", plan.PlannedRows)
	}
	// Three datasets cannot all keep a 50-row minimum inside a 100-row budget,
	// and the plan must say so rather than pretend the guarantee held.
	if plan.MinimumPerDatasetMet {
		t.Fatal("three 50-row minimums do not fit a 100-row budget; the plan must report that")
	}
	for _, dataset := range plan.Datasets {
		if dataset.PlannedRows <= 0 {
			t.Fatalf("dataset %s got no rows inside a reachable budget", dataset.Dataset)
		}
		if dataset.Complete {
			t.Fatalf("dataset %s cannot be complete inside a 100-row budget", dataset.Dataset)
		}
	}
}

func TestPlanRowBudgetReportsMoreDatasetsThanBudget(t *testing.T) {
	counts := make([]DatasetRowCount, 0, 5)
	for index := 0; index < 5; index++ {
		counts = append(counts, DatasetRowCount{
			Dataset:    string(rune('a' + index)),
			AssetTable: string(rune('a'+index)) + "_assets",
			RowCount:   100,
		})
	}

	plan := PlanRowBudget(counts, 3, 50)

	if !plan.DatasetsExceedBudget {
		t.Fatal("five datasets and a three-row budget must be reported, not hidden")
	}
	if plan.UncheckedDatasets != 2 {
		t.Fatalf("unchecked datasets = %d, want 2", plan.UncheckedDatasets)
	}
	if plan.PlannedRows != 3 {
		t.Fatalf("planned rows = %d, want the 3-row budget", plan.PlannedRows)
	}
}

func TestPlanRowBudgetHandlesEmptyInstallation(t *testing.T) {
	plan := PlanRowBudget(nil, 10000, 50)
	if len(plan.Datasets) != 0 || plan.PlannedRows != 0 || plan.DatasetsExceedBudget {
		t.Fatalf("empty installation plan = %+v, want an empty, unflagged plan", plan)
	}

	plan = PlanRowBudget([]DatasetRowCount{{Dataset: "a", AssetTable: "a_assets", RowCount: 0}}, 10000, 50)
	if len(plan.Datasets) != 0 || plan.TotalRows != 0 {
		t.Fatalf("dataset without media rows plan = %+v, want it left out", plan)
	}
}
