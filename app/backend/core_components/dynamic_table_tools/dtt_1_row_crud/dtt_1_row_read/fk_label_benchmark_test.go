// fk_label_benchmark_test.go
// Measures the get-results query builder on sixteen references to one dataset.
// Uses warm schema metadata and an in-process SQL driver, without database latency.
// Compare the same benchmark before and after authorization changes.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"net/url"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	dtt_utils "easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

func BenchmarkFKHeavyGetResults(b *testing.B) {
	counter := &buildJoinsQueryCounter{counts: map[string]int{}}
	name := fmt.Sprintf("fk_label_bench_%d", buildJoinsDriverCounter+1)
	buildJoinsDriverCounter++
	sql.Register(name, &buildJoinsMockDriver{counter: counter})
	db, err := sql.Open(name, "")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { db.Close(); resetJoinMetadataCacheForTests() })
	keys := map[string]dtt_utils.ForeignKey{}
	columns := map[int]dtt_models.ColumnInfo{}
	var uids []int
	for i := 1; i <= 16; i++ {
		column := fmt.Sprintf("target%d_id", i)
		keys[column] = dtt_utils.ForeignKey{ReferencedTable: "targets", ReferencedColumn: "id", NameColumn: "title"}
		columns[i] = dtt_models.ColumnInfo{ColumnName: column}
		uids = append(uids, i)
	}
	setCachedJoinMetadata("sources", joinMetadataCacheEntry{tableUID: "42", foreignKeys: keys})
	ctx := QueryBuilderContext{DB: db, TableName: "sources", ColumnsMap: columns, VisibleColUIDs: uids,
		QueryParams: url.Values{}, UserID: 7, UserRole: "user", ResultsPerLoad: 50, Offset: 1, ClientRowCount: 1000}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, _, _, _, err := BuildSelectQuery(ctx); err != nil {
			b.Fatal(err)
		}
	}
}
