// lang_embedding_tables.go
// Startup task that ensures embedding tables exist for all language-enabled dynamic tables.
// Creates missing embedding columns and pgvector indexes during server initialization.
// Exists to keep multilingual embedding infrastructure ready as datasets opt in.
package startup

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	backend "easelect/backend/core_components"
	"github.com/lib/pq"
)

// EnsureLangEmbeddingTables creates <table>_lang_embeddings for tables
// where system_db_tables.multi_lang_embeddings is TRUE.
func EnsureLangEmbeddingTables() {
	rows, err := backend.Db.Query(`SELECT table_name FROM system_db_tables WHERE multi_lang_embeddings`)
	if err != nil {
		log.Printf("ensure lang tables query error: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			log.Printf("scan multi lang table name: %v", err)
			continue
		}
		embTableName := name + "_lang_embeddings"
		embTable := pq.QuoteIdentifier(embTableName)
		hostTable := pq.QuoteIdentifier(name)
		create := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
            host_row_id INTEGER REFERENCES %s(id) ON DELETE CASCADE,
            language_code TEXT,
            embedding VECTOR,
            updated TIMESTAMP NOT NULL DEFAULT NOW(),
            content_md5 TEXT
        )`, embTable, hostTable)
		if _, err := backend.Db.Exec(create); err != nil {
			log.Printf("create %s error: %v", embTable, err)
			continue
		}
		_, _ = backend.Db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN IF NOT EXISTS content_md5 TEXT`, embTable))
		_, _ = backend.Db.Exec(fmt.Sprintf(`CREATE INDEX IF NOT EXISTS idx_%s_host ON %s (host_row_id)`, name, embTable))
		_, _ = backend.Db.Exec(fmt.Sprintf(`CREATE INDEX IF NOT EXISTS idx_%s_lang ON %s (language_code)`, name, embTable))
		_, _ = backend.Db.Exec(fmt.Sprintf(`CREATE INDEX IF NOT EXISTS idx_%s_vec ON %s USING hnsw (embedding)`, name, embTable))
		syncLangEmbeddingRuntimeGrants(name, embTableName)
	}
}

type langEmbeddingRoleGrant struct {
	role       string
	privileges []string
}

var langEmbeddingRuntimeRoles = []langEmbeddingRoleGrant{
	{role: "readeronly", privileges: []string{"SELECT"}},
	{role: "guest_user", privileges: []string{"SELECT"}},
	{role: "basic_user", privileges: []string{"SELECT", "INSERT", "UPDATE", "DELETE"}},
}

// syncLangEmbeddingRuntimeGrants mirrors the host table's runtime role access onto the
// auxiliary <table>_lang_embeddings table so policy-scoped reads and writes do not fail
// just because the helper table was created by the privileged startup connection.
func syncLangEmbeddingRuntimeGrants(hostTableName, embeddingTableName string) {
	embeddingTableIdentifier := pq.QuoteIdentifier(embeddingTableName)
	for _, roleGrant := range langEmbeddingRuntimeRoles {
		granted := make([]string, 0, len(roleGrant.privileges))
		hasInsertPrivilege := false
		for _, privilege := range roleGrant.privileges {
			var hasHostPrivilege bool
			err := backend.Db.QueryRow(
				`SELECT has_table_privilege($1, $2, $3)`,
				roleGrant.role,
				hostTableName,
				privilege,
			).Scan(&hasHostPrivilege)
			if err != nil {
				log.Printf("lang embedding host privilege check error for %s/%s on %s: %v", roleGrant.role, privilege, hostTableName, err)
				continue
			}
			if hasHostPrivilege {
				granted = append(granted, privilege)
				if privilege == "INSERT" {
					hasInsertPrivilege = true
				}
			}
		}
		if len(granted) == 0 {
			if hasInsertPrivilege {
				syncLangEmbeddingSequenceGrant(roleGrant.role, embeddingTableName)
			}
			continue
		}

		grant := fmt.Sprintf(
			`GRANT %s ON TABLE %s TO %s`,
			strings.Join(granted, ", "),
			embeddingTableIdentifier,
			pq.QuoteIdentifier(roleGrant.role),
		)
		if _, err := backend.Db.Exec(grant); err != nil {
			log.Printf("lang embedding grant error for %s on %s: %v", roleGrant.role, embeddingTableIdentifier, err)
		}
		if hasInsertPrivilege {
			syncLangEmbeddingSequenceGrant(roleGrant.role, embeddingTableName)
		}
	}
}

// syncLangEmbeddingSequenceGrant mirrors INSERT-capable runtime roles onto the helper
// table's serial/identity sequence so nextval() works on non-privileged request pools.
func syncLangEmbeddingSequenceGrant(role, embeddingTableName string) {
	var sequenceName sql.NullString
	if err := backend.Db.QueryRow(
		`SELECT pg_get_serial_sequence($1, 'id')`,
		embeddingTableName,
	).Scan(&sequenceName); err != nil {
		log.Printf("lang embedding sequence lookup error for %s on %s: %v", role, embeddingTableName, err)
		return
	}
	if !sequenceName.Valid || sequenceName.String == "" {
		return
	}

	grant := fmt.Sprintf(
		`GRANT USAGE, SELECT ON SEQUENCE %s TO %s`,
		quoteQualifiedIdentifier(sequenceName.String),
		pq.QuoteIdentifier(role),
	)
	if _, err := backend.Db.Exec(grant); err != nil {
		log.Printf("lang embedding sequence grant error for %s on %s: %v", role, sequenceName.String, err)
	}
}

func quoteQualifiedIdentifier(identifier string) string {
	if identifier == "" {
		return ""
	}
	parts := strings.Split(identifier, ".")
	for i, part := range parts {
		parts[i] = pq.QuoteIdentifier(strings.Trim(part, `"`))
	}
	return strings.Join(parts, ".")
}
