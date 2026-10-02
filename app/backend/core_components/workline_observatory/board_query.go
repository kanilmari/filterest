// board_query.go
// Applies the shared hero/filter controls to the Observatory's existing read model.
// Bridges a virtual dataset adapter with exact workline dimensions without SQL interpolation.
// Preserves the reported phase independently from lifecycle and scheduling priority.
package workline_observatory

import (
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

var worklinePriorityRank = map[string]int{"low": 0, "normal": 1, "high": 2, "critical": 3}

// queryBoardSnapshot retains the release goal and counts before filtering worklines.
// searchMatches holds the worklines the person's search found, best match first,
// or nil when there is no search; the search itself ran in the database as every
// dataset's search does (loadBoardSearchMatches).
func queryBoardSnapshot(snapshot BoardSnapshot, query url.Values, searchMatches []int64) (BoardSnapshot, error) {
	filters := make(map[string]map[string]bool)
	for _, field := range []string{"status", "priority", "current_phase"} {
		for _, suffix := range []string{"", "_exclude"} {
			key := field + suffix
			values := make(map[string]bool)
			for _, raw := range query[key] {
				for _, value := range strings.Split(raw, ",") {
					value = strings.TrimSpace(value)
					if value == "" {
						continue
					}
					valid := false
					switch field {
					case "status":
						_, valid = observatoryWorklineStatuses[value]
					case "priority":
						_, valid = worklinePriorityRank[value]
					case "current_phase":
						phase, err := strconv.Atoi(value)
						valid = err == nil && phase >= 0 && phase <= 6 && strconv.Itoa(phase) == value
					}
					if !valid {
						return snapshot, errors.New("invalid_workline_filter")
					}
					values[value] = true
				}
			}
			filters[key] = values
		}
	}
	column := strings.TrimSpace(query.Get("sort_column"))
	switch column {
	case "", "__newest", "id", "title", "status", "priority", "current_phase":
	default:
		return snapshot, errors.New("invalid_workline_sort_column")
	}
	order := strings.ToUpper(strings.TrimSpace(query.Get("sort_order")))
	if order != "" && order != "ASC" && order != "DESC" {
		return snapshot, errors.New("invalid_workline_sort_order")
	}
	var searchRank map[int64]int
	if searchMatches != nil {
		searchRank = make(map[int64]int, len(searchMatches))
		for position, id := range searchMatches {
			searchRank[id] = position
		}
	}
	snapshot.TotalCount = len(snapshot.Worklines)
	matches := make([]BoardWorkline, 0, len(snapshot.Worklines))
	for _, row := range snapshot.Worklines {
		values := map[string]string{"status": row.Status, "priority": row.Priority, "current_phase": strconv.Itoa(row.CurrentPhase)}
		include := true
		for field, value := range values {
			if (len(filters[field]) > 0 && !filters[field][value]) || filters[field+"_exclude"][value] {
				include = false
				break
			}
		}
		if !include {
			continue
		}
		if _, found := searchRank[row.ID]; searchRank != nil && !found {
			continue
		}
		matches = append(matches, row)
	}
	if searchRank != nil && column == "" {
		// Relevance is what a search means when the person has not chosen an
		// order, as in every dataset; a sort they chose, newest included, stays.
		sort.SliceStable(matches, func(i, j int) bool {
			return searchRank[matches[i].ID] < searchRank[matches[j].ID]
		})
	} else {
		// Every ordering has a stable ID tie-break; no query means the existing newest order.
		sort.SliceStable(matches, func(i, j int) bool {
			left, right := matches[i], matches[j]
			comparison := 0
			switch column {
			case "id":
				comparison = compareWorklineNumber(left.ID, right.ID)
			case "title":
				comparison = strings.Compare(strings.ToLower(left.Title), strings.ToLower(right.Title))
			case "status":
				comparison = strings.Compare(left.Status, right.Status)
			case "priority":
				comparison = compareWorklineNumber(int64(worklinePriorityRank[left.Priority]), int64(worklinePriorityRank[right.Priority]))
			case "current_phase":
				comparison = compareWorklineNumber(int64(left.CurrentPhase), int64(right.CurrentPhase))
			default:
				comparison = left.UpdatedAt.Compare(right.UpdatedAt)
			}
			if comparison == 0 {
				comparison = compareWorklineNumber(left.ID, right.ID)
			}
			if order == "ASC" {
				return comparison < 0
			}
			return comparison > 0
		})
	}
	snapshot.Worklines = matches
	snapshot.FilteredCount = len(matches)
	return snapshot, nil
}

func compareWorklineNumber(left, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}
