// permissions_writer_postgres_test.go
// Proves the rights INSERT's parameter types on current and legacy column widths.
// Reuses the opt-in disposable cluster; no site database or network is contacted.
// Covers dataset/tableless rights, duplicate suppression and transaction rollback.
package backend

import "testing"

func TestPermissionWriterParameterTypesPostgres(t *testing.T) {
	cluster := startWriteRevocationCluster(t)
	db := cluster.open("test_owner", "postgres")
	for _, width := range []string{"integer", "bigint"} {
		t.Run(width, func(t *testing.T) {
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			// Rollback removes each isolated fixture before the next width.
			if _, err := tx.Exec(`CREATE TABLE system_group_table_func_rights(
				user_group_id ` + width + `,function_id ` + width + `,
				target_schema_name text,target_table_uid ` + width + `)`); err != nil {
				t.Fatal(err)
			}
			for _, permission := range []Permission{
				{AuthUserGroupID: 2, FunctionID: 1, TargetSchemaName: "public", TargetTableUID: 17},
				{AuthUserGroupID: 2, FunctionID: 2},
			} {
				for attempt := 0; attempt < 2; attempt++ {
					inserted, err := insertPermission(tx, permission)
					if err != nil || inserted != (attempt == 0) {
						t.Fatalf("uid=%d attempt=%d inserted=%v: %v", permission.TargetTableUID, attempt, inserted, err)
					}
				}
			}
			var datasets, tableless int
			if err := tx.QueryRow(`SELECT count(*) FILTER(WHERE target_table_uid=17),
				count(*) FILTER(WHERE target_table_uid IS NULL) FROM system_group_table_func_rights`).Scan(&datasets, &tableless); err != nil || datasets != 1 || tableless != 1 {
				t.Fatalf("dataset/tableless rights=%d/%d: %v", datasets, tableless, err)
			}
		})
	}
}
