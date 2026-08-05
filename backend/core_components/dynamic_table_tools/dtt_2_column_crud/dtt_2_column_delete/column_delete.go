// column_delete.go
// HTTP handler for deleting a column from a dynamic table. Validates the request, removes the
// column from the database schema, and cleans up associated metadata records.
// Exists to keep schema and Easelect metadata aligned after column removal.
package dtt_2_column_delete

import (
	"database/sql"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/security"
	"fmt"
	"log"
	"strings"
)

func RemoveColumns(tx *sql.Tx, sanitizedTableName string, removedCols []string) error {
	fmt.Println("Removing columns (if any):", removedCols)

	// Haetaan ensin taulun primary key -sarakkeet, jotta voidaan estää niiden poisto.
	pkCols, err := dtt_2_column_crud.GetPrimaryKeyColumns(tx, sanitizedTableName)
	if err != nil {
		return err
	}

	for _, col := range removedCols {
		sCol, err2 := security.SanitizeIdentifier(col)
		if err2 != nil {
			return err2
		}

		// Estetään primary key -sarakkeen poistaminen.
		if _, isPK := pkCols[strings.ToLower(sCol)]; isPK {
			return fmt.Errorf("cannot remove column '%s' from table '%s': it is a primary key", sCol, sanitizedTableName)
		}

		dropStmt := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", sanitizedTableName, sCol)
		fmt.Println("Executing:", dropStmt)
		_, err2 = tx.Exec(dropStmt)
		if err2 != nil {
			fmt.Println("Error removing column:", err2)
			return err2
		}

		// Clean up lang key sources for the removed column.
		if cleanErr := lang.CleanupLangKeySourcesForColumn(tx, sanitizedTableName, sCol); cleanErr != nil {
			log.Printf("[RemoveColumns] warning: lang key source cleanup for column %s.%s: %v", sanitizedTableName, sCol, cleanErr)
			// Non-fatal: column is already dropped, metadata cleanup is best-effort.
		}
	}
	return nil
}
