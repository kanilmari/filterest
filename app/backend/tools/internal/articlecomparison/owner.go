// owner.go
// Formats the value-free owner list as Markdown and CSV.
// Connects exact protected differences to dataset/group names, counts and flags.
// Personal surfaces are summed per dataset/presentation and never emit user ids.
package articlecomparison

import (
	"encoding/csv"
	"fmt"
	"html"
	"io"
	"sort"
	"strconv"
	"strings"
)

type OwnerRow struct {
	Dataset, Kind, Group, Presentation     string
	Targets, Before, After, Added, Removed int
	Order, Widths, Blocks, Audience, Other bool
	uid                                    int
	id                                     int64
}

// OwnerRows removes all column names, source identities, hashes and user ids.
func OwnerRows(differences []Difference) []OwnerRow {
	rows := []OwnerRow{}
	personal := map[string]int{}
	for _, d := range differences {
		row := OwnerRow{Dataset: d.Dataset, Kind: d.TargetKind, Group: d.Group, Presentation: d.Presentation, Targets: 1, Before: d.BeforeCount, After: d.AfterCount, Added: d.Added, Removed: d.Removed, Order: d.Order, Widths: d.Widths, Blocks: d.Blocks, Audience: d.Audience, Other: d.Other, uid: d.DatasetUID}
		if d.TargetKind != "personal" && d.TargetID != nil {
			row.id = *d.TargetID
		}
		if d.TargetKind == "personal" {
			key := fmt.Sprintf("%d/%s", d.DatasetUID, d.Presentation)
			if index, ok := personal[key]; ok {
				r := &rows[index]
				r.Targets++
				r.Before += row.Before
				r.After += row.After
				r.Added += row.Added
				r.Removed += row.Removed
				r.Order = r.Order || row.Order
				r.Widths = r.Widths || row.Widths
				r.Blocks = r.Blocks || row.Blocks
				r.Audience = r.Audience || row.Audience
				r.Other = r.Other || row.Other
				continue
			}
			personal[key] = len(rows)
		}
		rows = append(rows, row)
	}
	rank := map[string]int{"metadata": 0, "site": 1, "group": 2, "personal": 3}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.uid != b.uid {
			return a.uid < b.uid
		}
		if a.Kind != b.Kind {
			return rank[a.Kind] < rank[b.Kind]
		}
		if a.id != b.id {
			return a.id < b.id
		}
		return a.Presentation < b.Presentation
	})
	return rows
}
func label(key string) string {
	switch key {
	case "article_view":
		return "Article"
	case "image_first_view":
		return "IFAV"
	default:
		return "Page"
	}
}
func flag(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}
func markdownCell(s string) string {
	s = html.EscapeString(s)
	s = strings.ReplaceAll(s, "|", "&#124;")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}
func csvCell(s string) string {
	// Avoid spreadsheet formula execution through a configuration name.
	trimmed := strings.TrimLeft(s, " \t\r\n")
	if len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0])) || strings.HasPrefix(s, "\t") || strings.HasPrefix(s, "\r") {
		return "'" + s
	}
	return s
}

// WriteMarkdown also serves value-free unlisted/missing diagnostics.
func WriteMarkdown(w io.Writer, rows []OwnerRow, unchanged int, sha string) error {
	if _, err := fmt.Fprintf(w, "Approval SHA256: %s\n\nUnchanged target × presentation surfaces omitted: %d. Personal field counts sum changed reader surfaces.\n\n", sha, unchanged); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(w, "| Dataset | Target | Group | Presentation | Changed targets | Fields before → after | Added | Removed | Order | Widths | Blocks | Audience | Other evidence |\n| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |"); err != nil {
		return err
	}
	for _, r := range rows {
		if _, err := fmt.Fprintf(w, "| %s | %s | %s | %s | %d | %d → %d | %d | %d | %s | %s | %s | %s | %s |\n", markdownCell(r.Dataset), r.Kind, markdownCell(r.Group), label(r.Presentation), r.Targets, r.Before, r.After, r.Added, r.Removed, flag(r.Order), flag(r.Widths), flag(r.Blocks), flag(r.Audience), flag(r.Other)); err != nil {
			return err
		}
	}
	return nil
}

// WriteCSV includes summary columns so the digest and omitted count travel with it.
func WriteCSV(w io.Writer, rows []OwnerRow, unchanged int, sha string) error {
	c := csv.NewWriter(w)
	if err := c.Write([]string{"record", "dataset", "target_kind", "group", "presentation", "changed_targets", "fields_before", "fields_after", "added", "removed", "order", "widths", "blocks", "audience", "other_evidence", "unchanged_surfaces", "approval_sha256"}); err != nil {
		return err
	}
	for _, r := range rows {
		if err := c.Write([]string{"difference", csvCell(r.Dataset), r.Kind, csvCell(r.Group), label(r.Presentation), strconv.Itoa(r.Targets), strconv.Itoa(r.Before), strconv.Itoa(r.After), strconv.Itoa(r.Added), strconv.Itoa(r.Removed), flag(r.Order), flag(r.Widths), flag(r.Blocks), flag(r.Audience), flag(r.Other), "", ""}); err != nil {
			return err
		}
	}
	if err := c.Write([]string{"summary", "", "", "", "", "", "", "", "", "", "", "", "", "", "", strconv.Itoa(unchanged), sha}); err != nil {
		return err
	}
	c.Flush()
	return c.Error()
}
