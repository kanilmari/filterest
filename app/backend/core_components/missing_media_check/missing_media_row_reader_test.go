// missing_media_row_reader_test.go
// Verifies how the sample points of a large dataset are chosen.
// Between the sampling setting and the lookup statements that read one row per point.
// Exists so an even sample always reaches the newest rows, a random one repeats from its
// seed, and neither leaves the dataset's own id range.
package missing_media_check

import (
	"math"
	"reflect"
	"sort"
	"testing"
)

func TestEvenSampleIncludesBothEndsAndSpreadsEvenly(t *testing.T) {
	targets := sampleTargets(rowSample{Method: SamplingEven}, 1, 1001, 5)
	if want := []int64{1, 251, 501, 751, 1001}; !reflect.DeepEqual(targets, want) {
		t.Fatalf("even targets = %v, want %v", targets, want)
	}
	// The old stride sample read the first rows of every stride and never the tail.
	if last := sampleTargets(rowSample{Method: SamplingEven}, 10, 99990, 3); last[len(last)-1] != 99990 {
		t.Fatalf("even targets = %v, want the newest id last", last)
	}
	if single := sampleTargets(rowSample{Method: SamplingEven}, 10, 500, 1); !reflect.DeepEqual(single, []int64{500}) {
		t.Fatalf("a single even target = %v, want the newest id", single)
	}
}

func TestEvenSampleStaysExactAcrossTheWholeIDRange(t *testing.T) {
	targets := sampleTargets(rowSample{Method: SamplingEven}, math.MinInt64, math.MaxInt64, 3)
	if want := []int64{math.MinInt64, -1, math.MaxInt64}; !reflect.DeepEqual(targets, want) {
		t.Fatalf("full-range targets = %v, want %v", targets, want)
	}
}

func TestRandomSampleRepeatsFromItsSeedAndStaysInRange(t *testing.T) {
	first := sampleTargets(rowSample{Method: SamplingRandom, Seed: 42}, 100, 900, 50)
	second := sampleTargets(rowSample{Method: SamplingRandom, Seed: 42}, 100, 900, 50)
	if !reflect.DeepEqual(first, second) {
		t.Fatal("the same seed must repeat the same sample")
	}
	other := sampleTargets(rowSample{Method: SamplingRandom, Seed: 43}, 100, 900, 50)
	if reflect.DeepEqual(first, other) {
		t.Fatal("another seed must draw another sample")
	}
	if !sort.SliceIsSorted(first, func(a, b int) bool { return first[a] < first[b] }) {
		t.Fatalf("random targets = %v, want them in ascending order for the lookups", first)
	}
	for _, target := range first {
		if target < 100 || target > 900 {
			t.Fatalf("random target %d lies outside the dataset's ids 100..900", target)
		}
	}
	whole := sampleTargets(rowSample{Method: SamplingRandom, Seed: 7}, math.MinInt64, math.MaxInt64, 4)
	if len(whole) != 4 {
		t.Fatalf("random targets over the whole id range = %v, want four", whole)
	}
}

func TestAShortIDRangeIsCoveredIDByID(t *testing.T) {
	for _, method := range []string{SamplingEven, SamplingRandom} {
		targets := sampleTargets(rowSample{Method: method, Seed: 1}, 5, 8, 100)
		if want := []int64{5, 6, 7, 8}; !reflect.DeepEqual(targets, want) {
			t.Fatalf("%s targets over four ids = %v, want every id once", method, targets)
		}
	}
	if targets := sampleTargets(rowSample{Method: SamplingEven}, 5, 8, 0); targets != nil {
		t.Fatalf("no planned rows = %v, want no targets", targets)
	}
}

func TestEachDatasetHasItsOwnStableRandomStream(t *testing.T) {
	if datasetSeed(42, "a_assets") != datasetSeed(42, "a_assets") {
		t.Fatal("one dataset must keep its stream for one run seed")
	}
	if datasetSeed(42, "a_assets") == datasetSeed(42, "b_assets") {
		t.Fatal("two datasets must not share one random stream")
	}
}

func TestAnEstimatedDatasetIsNeverComplete(t *testing.T) {
	plan := PlanRowBudget([]DatasetRowCount{
		{Dataset: "huge", AssetTable: "huge_assets", RowCount: 500, Estimated: true},
		{Dataset: "small", AssetTable: "small_assets", RowCount: 20},
	}, 10000, 50)
	for _, dataset := range plan.Datasets {
		switch dataset.Dataset {
		case "huge":
			if dataset.Complete || !dataset.Estimated || dataset.PlannedRows != 500 {
				t.Fatalf("estimated dataset budget = %+v, want every estimated row planned and never complete", dataset)
			}
		case "small":
			if !dataset.Complete {
				t.Fatalf("counted dataset budget = %+v, want it complete", dataset)
			}
		}
	}
}
