// column_create.go
// Executes ALTER TABLE ADD COLUMN statements for newly added columns.
// Called as part of the column modification workflow when new columns
// are added to an existing table.

package dtt_2_column_create

import (
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud" // esim. täältä saa ModifiedCol
	security "easelect/backend/core_components/security"
	"fmt"
	"strings"
)

func AddNewColumns(tx *sql.Tx, sanitizedTableName string, addedCols []dtt_2_column_crud.ModifiedCol) error {
	fmt.Println("Adding new columns (if any):", addedCols)
	for _, acol := range addedCols {
		fmt.Println("Adding column:", acol)
		sNewName, err2 := security.SanitizeIdentifier(acol.NewName)
		if err2 != nil {
			return err2
		}

		newType := strings.ToUpper(acol.DataType)
		if newType == "VARCHAR" && acol.Length != nil {
			newType = fmt.Sprintf("VARCHAR(%d)", *acol.Length)
		}

		addStmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s",
			sanitizedTableName, sNewName, newType)

		fmt.Println("Executing:", addStmt)
		_, err2 = tx.Exec(addStmt)
		if err2 != nil {
			fmt.Println("Error adding new column:", err2)
			return err2
		}
	}
	return nil
}
