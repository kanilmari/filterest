// table_metadata_cleanup.go
// Cleans up all metadata records associated with a deleted dynamic table. Removes entries from
// system_db_tables, system_column_details, and related metadata tables.
// Exists to prevent orphaned configuration after a dataset table is dropped.
package dtt_3_table_delete

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/lang"
	"fmt"
	"log"
)

// rowsAffected palauttaa sql.Result:n RowsAffected-arvon, tai 0 jos virhe.
func rowsAffected(res interface{ RowsAffected() (int64, error) }) int64 {
	n, err := res.RowsAffected()
	if err != nil {
		return 0
	}
	return n
}

// CleanupTableMetadata poistaa kaikki tauluun liittyvät metatiedot system-tauluista.
// Tämä sisältää viiteavainsuhteet, oikeudet, saraketiedot ja muut liittyvät objektit.
// Funktio saa Querier-rajapinnan, joten se toimii sekä *sql.Tx:n että *sql.DB:n kanssa.
// Kutsujan vastuulla on commitoida transaktio tarvittaessa.
func CleanupTableMetadata(q dbutils.Querier, tableUID int64, schemaName string) error {

	log.Printf("[CleanupTableMetadata] Starting metadata cleanup: table_uid=%d, schema=%s", tableUID, schemaName)

	// 1. Poistetaan viiteavainsuhteet (1:M) joissa tämä taulu on mukana
	res, err := q.Exec(`
		DELETE FROM system_foreign_key_relations_1_m 
		WHERE source_table_uid = $1 OR target_table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete 1:M foreign key relations: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_foreign_key_relations_1_m: deleted %d rows", n)
	}

	// 2. Poistetaan viiteavainsuhteet (M:M) joissa tämä taulu on mukana
	res, err = q.Exec(`
		DELETE FROM system_foreign_key_relations_m_m 
		WHERE table_a_uid = $1 OR table_b_uid = $1 OR bridging_table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete M:M foreign key relations: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_foreign_key_relations_m_m: deleted %d rows", n)
	}

	// 3. Poistetaan ryhmäoikeudet tälle taululle
	res, err = q.Exec(`
		DELETE FROM system_group_table_func_rights 
		WHERE target_table_uid = $1 AND target_schema_name = $2`, tableUID, schemaName)
	if err != nil {
		return fmt.Errorf("failed to delete group rights: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_group_table_func_rights: deleted %d rows", n)
	}

	// 4. Poistetaan käyttäjäkohtaiset sarake-asetukset
	res, err = q.Exec(`
		DELETE FROM system_user_column_settings 
		WHERE table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete user column settings: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_user_column_settings: deleted %d rows", n)
	}

	// 5. Poistetaan rivinäyttölaskurit
	res, err = q.Exec(`
		DELETE FROM system_table_row_view_counts 
		WHERE table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete row view counts: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_table_row_view_counts: deleted %d rows", n)
	}

	// 6. Poistetaan sarakkeiden hallintadata
	res, err = q.Exec(`
		DELETE FROM system_column_control 
		WHERE table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete column control data: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_column_control: deleted %d rows", n)
	}

	// 7. Poistetaan saraketiedot
	res, err = q.Exec(`
		DELETE FROM system_column_details 
		WHERE table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete column details: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_column_details: deleted %d rows", n)
	}

	// 8. Poistetaan lang key sources ja orpoutuneet lang keys.
	//    Haetaan taulun nimi table_uid:n perusteella, koska lang key sources
	//    käyttää taulun nimeä (source_high), ei schema-nimeä.
	var tableName string
	if err := q.QueryRow(`SELECT table_name FROM system_db_tables WHERE table_uid = $1`, tableUID).Scan(&tableName); err == nil && tableName != "" {
		if cleanErr := lang.CleanupLangKeySourcesForTable(q, tableName); cleanErr != nil {
			log.Printf("[CleanupTableMetadata]   - lang key source cleanup warning: %v", cleanErr)
			// Non-fatal: metadata cleanup should not fail the entire drop operation.
		}
	} else {
		log.Printf("[CleanupTableMetadata]   - skipping lang key cleanup: could not resolve table name for uid=%d", tableUID)
	}

	// 9. Lopuksi poistetaan itse taulun merkintä system_db_tables-taulusta
	res, err = q.Exec(`
		DELETE FROM system_db_tables 
		WHERE table_uid = $1`, tableUID)
	if err != nil {
		return fmt.Errorf("failed to delete table entry: %w", err)
	}
	if n := rowsAffected(res); n > 0 {
		log.Printf("[CleanupTableMetadata]   - system_db_tables: deleted %d rows", n)
	}

	log.Printf("[CleanupTableMetadata] Metadata cleanup complete: table_uid=%d", tableUID)
	return nil
}
