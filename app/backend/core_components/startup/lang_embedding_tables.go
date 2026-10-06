// lang_embedding_tables.go
// Creates schema-qualified embedding helpers before the final startup ACL policy.
// Later creation uses an administrator transaction and the live mutation boundary.
// Grants never come from mirroring a host's historical ACLs.
package startup

import (
	"context"
	"database/sql"
	"fmt"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtime_grant_mutations"
	"github.com/lib/pq"
)

// EnsureLangEmbeddingTables is the live entry point. Every DDL and grant shares
// one administrator transaction; callers must handle its returned error.
func EnsureLangEmbeddingTables() error {
	ctx := context.Background()
	if backend.DbAdmin == nil {
		return fmt.Errorf("embedding administrator database is missing")
	}
	tx, err := backend.DbAdmin.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	mutation, err := runtime_grant_mutations.BeginTx(ctx, tx)
	if err != nil {
		return err
	}
	if err = createLangEmbeddingTables(ctx, tx); err != nil {
		return err
	}
	if err = mutation.Finish(ctx); err != nil {
		return err
	}
	return tx.Commit()
}

// EnsureStartupLangEmbeddingTables runs only under the exclusive startup
// barrier. The final catalogue reconciliation owns all grants, exactly once.
func EnsureStartupLangEmbeddingTables(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = createLangEmbeddingTables(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func createLangEmbeddingTables(ctx context.Context, tx *sql.Tx) error {
	// A restored registry may name a missing legacy dataset. It remains an audit
	// finding, not a reason to manufacture a helper or fail unrelated startup.
	rows, err := tx.QueryContext(ctx, `SELECT COALESCE(NULLIF(schema_name,''),'public'),table_name FROM system_db_tables
 WHERE multi_lang_embeddings AND to_regclass(format('%I.%I',COALESCE(NULLIF(schema_name,''),'public'),table_name)) IS NOT NULL`)
	if err != nil {
		return fmt.Errorf("embedding dataset discovery: %w", err)
	}
	type table struct{ schema, name string }
	var tables []table
	for rows.Next() {
		var t table
		if err = rows.Scan(&t.schema, &t.name); err != nil {
			rows.Close()
			return err
		}
		tables = append(tables, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, t := range tables {
		host := pq.QuoteIdentifier(t.schema) + "." + pq.QuoteIdentifier(t.name)
		embedding := pq.QuoteIdentifier(t.schema) + "." + pq.QuoteIdentifier(t.name+"_lang_embeddings")
		statements := []string{
			fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (host_row_id INTEGER REFERENCES %s(id) ON DELETE CASCADE,
 language_code TEXT, embedding VECTOR, updated TIMESTAMP NOT NULL DEFAULT NOW(), content_md5 TEXT)`, embedding, host),
			"ALTER TABLE " + embedding + " ADD COLUMN IF NOT EXISTS content_md5 TEXT",
		}
		// The unconstrained vector column accepts different model dimensions.
		// HNSW needs a dimension and operator class; the old untyped index
		// attempt always failed and was ignored. Model-specific acceleration
		// belongs to embedding search, not this required table-creation step.
		for _, index := range []struct{ suffix, column string }{{"host", "host_row_id"}, {"lang", "language_code"}} {
			statements = append(statements, "CREATE INDEX IF NOT EXISTS "+pq.QuoteIdentifier("idx_"+t.name+"_"+index.suffix)+" ON "+embedding+" ("+pq.QuoteIdentifier(index.column)+")")
		}
		for _, statement := range statements {
			if _, err = tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("embedding table %s: %w", embedding, err)
			}
		}
	}
	return nil
}
