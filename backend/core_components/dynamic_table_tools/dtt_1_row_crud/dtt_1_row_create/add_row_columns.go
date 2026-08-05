// add_row_columns.go
// Fetches column metadata for the add-row form, filtering out system columns.
// Bridges the system_column_details table and the frontend new-row form renderer.
// Exists to provide column and relationship metadata needed to render add-row forms.

package dtt_1_row_create

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// GetAddRowColumnsHandlerWrapper on HTTP-rajapintafunktio, joka hakee lisättävän rivin saraketiedot.
// Se ottaa vastaan tauluparametrin, jonka avulla ohjataan varsinaiseen käsittelijään.
func GetAddRowColumnsHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableUID := r.URL.Query().Get("table_uid")
	if tableUID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Missing table_uid parameter")
		return
	}
	GetAddRowColumnsHandler(w, r, tableUID)
}

// GetAddRowColumnsHandler hakee sarakkeiden tiedot tietylle taululle (tableUID).
func GetAddRowColumnsHandler(w http.ResponseWriter, r *http.Request, tableUID string) {
	schemaName := "public"
	tableName, err := getTableNameFromUID(tableUID, backend.Db)
	if err != nil {
		log.Printf("error fetching table name for uid %s: %v", tableUID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching table name")
		return
	}
	userRole := getSessionUserRoleOrGuest(r)

	columns, err := getAddRowColumnsWithTypes(tableUID, schemaName)
	if err != nil {
		log.Printf("error fetching columns for table %s: %v", tableUID, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching columns")
		return
	}

	// Sarakkeet, jotka jätetään pois lomakkeelta (tarkka nimivastaavuus)
	excludeColumns := map[string]bool{
		"id":               true,
		"created":          true,
		"updated":          true,
		"embedding_vector": true,
		"creation_spec":    true,
		"admin_reviewed":   true,
		"admin_approved":   true,
	}

	// Sarakeprefiksit, joiden perusteella sarakkeet jätetään pois
	prefixExcludes := []string{"cached_"}

	var columnsForFrontend []dtt_models.AddRowColumnInfo

ColLoop:
	for _, col := range columns {
		colNameLower := strings.ToLower(col.ColumnName)

		// Metadata-owned values (for example the current row owner) are filled
		// by the server and must never be requested from the add-row form.
		if !isAddRowColumnUserInsertable(col) {
			continue
		}

		// 1) Onko sarake exclude-listalla?
		if excludeColumns[colNameLower] {
			continue
		}

		// 1b) Onko sarakeprefiksien listoilla?
		for _, prefix := range prefixExcludes {
			if strings.HasPrefix(colNameLower, prefix) {
				continue ColLoop
			}
		}

		// 2) Onko sarake identity tai onko sillä oletus?
		if strings.ToUpper(col.IsIdentity) == "YES" || col.ColumnDefault != "" {
			continue
		}

		// 3) Onko InsertNewTargetWithSource voimassa ja asettunut falseksi?
		if col.InsertNewTargetWithSource.Valid && !col.InsertNewTargetWithSource.Bool {
			continue
		}

		// 4) Onko InsertNewSourceWithTarget voimassa ja asettunut falseksi?
		if col.InsertNewSourceWithTarget.Valid && !col.InsertNewSourceWithTarget.Bool {
			continue
		}

		// Jos kaikki ok, lisätään sarake listalle
		columnsForFrontend = append(columnsForFrontend, col)
	}
	columnsForFrontend = filterPilotCreateColumns(tableName, userRole, columnsForFrontend)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(columnsForFrontend); err != nil {
		log.Printf("error encoding response: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding response")
	}
}

// getAddRowColumnsWithTypes hakee saraketiedot tietokannan information_schema.columns -näkymästä.
func getAddRowColumnsWithTypes(tableUID, schemaName string) ([]dtt_models.AddRowColumnInfo, error) {
	query := `
    SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.is_identity,
        c.generation_expression,
        fk_info.foreign_table_schema,
        fk_info.foreign_table_name,
        fk_info.foreign_column_name,
        c.udt_name,
		fk_rel.insert_new_target_with_source,
		fk_rel.insert_new_source_with_target,
		fk_rel.source_insert_specs,
		fk_rel.target_insert_specs,
		scd.insertable
    FROM information_schema.columns c
    JOIN system_db_tables sdt
        ON sdt.table_uid = $1 AND sdt.table_name = c.table_name
    LEFT JOIN system_column_details scd
        ON scd.table_uid = sdt.table_uid AND scd.column_name = c.column_name
    LEFT JOIN (
        SELECT
            kcu.column_name,
            kcu.table_name AS column_table_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
        WHERE
            tc.constraint_type = 'FOREIGN KEY'
    ) AS fk_info
        ON c.column_name = fk_info.column_name
        AND c.table_name = fk_info.column_table_name
    LEFT JOIN system_foreign_key_relations_1_m fk_rel
        ON fk_rel.source_table_uid = sdt.table_uid AND c.column_name = fk_rel.source_column_name
    WHERE
        c.table_schema = $2
        AND sdt.table_uid = $1
    ORDER BY
        scd.co_number,
        c.ordinal_position;
`

	rows, err := backend.Db.Query(query, tableUID, schemaName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []dtt_models.AddRowColumnInfo

	for rows.Next() {
		var col dtt_models.AddRowColumnInfo
		var columnDefault sql.NullString
		var generationExpression sql.NullString
		var foreignTableSchema sql.NullString
		var foreignTableName sql.NullString
		var foreignColumnName sql.NullString
		var udtName string

		// Muutetaan nämä kahdeksi NullBooliksi
		var insertNewTargetWithSource sql.NullBool
		var insertNewSourceWithTarget sql.NullBool

		var sourceInsertSpecs sql.NullString
		var targetInsertSpecs sql.NullString
		var insertable sql.NullBool

		if err := rows.Scan(
			&col.ColumnName,
			&col.DataType,
			&col.IsNullable,
			&columnDefault,
			&col.IsIdentity,
			&generationExpression,
			&foreignTableSchema,
			&foreignTableName,
			&foreignColumnName,
			&udtName,
			&insertNewTargetWithSource,
			&insertNewSourceWithTarget,
			&sourceInsertSpecs,
			&targetInsertSpecs,
			&insertable,
		); err != nil {
			return nil, err
		}

		col.ColumnDefault = columnDefault.String
		col.GenerationExpression = generationExpression.String
		col.ForeignTableSchema = foreignTableSchema.String
		col.ForeignTableName = foreignTableName.String
		col.ForeignColumnName = foreignColumnName.String
		col.UdtName = udtName
		col.InsertNewTargetWithSource = insertNewTargetWithSource
		col.InsertNewSourceWithTarget = insertNewSourceWithTarget
		col.SourceInsertSpecs = sourceInsertSpecs.String
		col.TargetInsertSpecs = targetInsertSpecs.String
		col.Insertable = insertable

		// Jos data_type == "USER-DEFINED" ja udt_name == "geometry", tulkitaan data_type = "geometry"
		if strings.ToLower(col.DataType) == "user-defined" && strings.ToLower(col.UdtName) == "geometry" {
			col.DataType = "geometry"
		}

		columns = append(columns, col)
	}

	return columns, nil
}

// GetAddRowColumnsOrdered on esimerkki taulun sarakkeiden hakemisesta järjestyksessä.
func GetAddRowColumnsOrdered(tableUID string) ([]dtt_models.ColumnInfo, error) {
	// Huom: käytetään esimerkin vuoksi suoraan "SELECT ... ORDER BY co_number" ( = column order number )
	query := `
        SELECT
            scd.column_uid,
            scd.column_name,
            scd.co_number
        FROM system_column_details scd
        JOIN system_db_tables sdt ON sdt.table_uid = scd.table_uid
        WHERE sdt.table_uid = $1
        ORDER BY scd.co_number
    `

	rows, err := backend.Db.Query(query, tableUID)
	if err != nil {
		return nil, fmt.Errorf("\033[31merror: %v\033[0m", err)
	}
	defer rows.Close()

	var columns []dtt_models.ColumnInfo
	for rows.Next() {
		var col dtt_models.ColumnInfo
		err := rows.Scan(&col.ColumnUid, &col.ColumnName, &col.CoNumber)
		if err != nil {
			return nil, fmt.Errorf("\033[31merror: %v\033[0m", err)
		}
		columns = append(columns, col)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("\033[31merror: %v\033[0m", err)
	}

	return columns, nil
}

///
/// New unified handler for AddRowMetadata
///

func GetAddRowMetadataHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableUID := r.URL.Query().Get("table_uid")
	if tableUID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'table_uid' query parameter")
		return
	}
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET requests are allowed")
		return
	}

	if err := GetAddRowMetadataHandler(w, tableUID); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error()) // punainen virhe
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching row add metadata")
	}
}

func GetAddRowMetadataHandler(w http.ResponseWriter, tableUID string) error {
	schemaName := "public"

	// 1) Saraketiedot
	columns, err := getAddRowColumnsWithTypes(tableUID, schemaName)
	if err != nil {
		return err
	}

	// 2) 1->m-suhteet
	oneToMany, err := getOneToManyRelations(tableUID)
	if err != nil {
		return err
	}

	// 3) m->m-suhteet
	manyToMany, err := getManyToMany(tableUID)
	if err != nil {
		return err
	}

	// Kääritään kaikki yhteen rakenteeseen
	payload := map[string]interface{}{
		"columns":            columns,
		"oneToManyRelations": oneToMany,
		"manyToManyInfos":    manyToMany,
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(payload)
}

// getOneToManyRelations lukee system_foreign_key_relations_1_m -taulusta, kuten
// GetOneToManyRelationsHandler, mutta palauttaa arvot suoraan koodissa.
func getOneToManyRelations(mainTableUID string) ([]OneToManyRelation, error) {
	query := `
    SELECT
        fr.source_table_uid,
        s_src.table_name AS source_table_name,
        fr.source_column_name,
        fr.target_table_uid,
        s_tgt.table_name AS target_table_name,
        fr.target_column_name,
        fr.insert_new_target_with_source,
        fr.insert_new_source_with_target,
        fr.source_insert_specs,
        fr.target_insert_specs,
        fr.reference_direction
    FROM system_foreign_key_relations_1_m fr
    JOIN system_db_tables s_src ON s_src.table_uid = fr.source_table_uid
    JOIN system_db_tables s_tgt ON s_tgt.table_uid = fr.target_table_uid
    WHERE fr.target_table_uid = $1
    `
	rows, err := backend.Db.Query(query, mainTableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []OneToManyRelation
	for rows.Next() {
		var rel OneToManyRelation
		var sourceInsert sql.NullString
		var targetInsert sql.NullString
		if err := rows.Scan(
			&rel.SourceTableUID,
			&rel.SourceTableName,
			&rel.SourceColumnName,
			&rel.TargetTableUID,
			&rel.TargetTableName,
			&rel.TargetColumnName,
			&rel.InsertNewTargetWithSource,
			&rel.InsertNewSourceWithTarget,
			&sourceInsert,
			&targetInsert,
			&rel.ReferenceDirection,
		); err != nil {
			return nil, err
		}
		rel.SourceInsertSpecs = sourceInsert.String
		rel.TargetInsertSpecs = targetInsert.String
		results = append(results, rel)
	}
	return results, nil
}

// getManyToMany lukee system_foreign_key_relations_m_m -taulua, kuten
// GetManyToManyTablesHandler, mutta palauttaa tiedot suoraan.
func getManyToMany(mainTableUID string) ([]ManyToManyInfo, error) {
	query := `
        SELECT
            fr.bridging_table_uid,
            s_br.table_name AS bridging_table_name,
            CASE
                WHEN fr.table_a_uid = $1 THEN fr.bridging_col_a
                ELSE fr.bridging_col_b
            END AS main_table_fk_column,
            CASE
                WHEN fr.table_a_uid = $1 THEN fr.table_b_uid
                ELSE fr.table_a_uid
            END AS third_table_uid,
            CASE
                WHEN fr.table_a_uid = $1 THEN s_b.table_name
                ELSE s_a.table_name
            END AS third_table_name,
            CASE
                WHEN fr.table_a_uid = $1 THEN fr.bridging_col_b
                ELSE fr.bridging_col_a
            END AS third_table_fk_column
        FROM system_foreign_key_relations_m_m fr
        JOIN system_db_tables s_br ON s_br.table_uid = fr.bridging_table_uid
        JOIN system_db_tables s_a  ON s_a.table_uid = fr.table_a_uid
        JOIN system_db_tables s_b  ON s_b.table_uid = fr.table_b_uid
        WHERE (fr.table_a_uid = $1 OR fr.table_b_uid = $1);
    `
	rows, err := backend.Db.Query(query, mainTableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []ManyToManyInfo
	for rows.Next() {
		var info ManyToManyInfo
		if err := rows.Scan(
			&info.LinkTableUID,
			&info.LinkTableName,
			&info.MainTableFkColumn,
			&info.ThirdTableUID,
			&info.ThirdTableName,
			&info.ThirdTableFkColumn,
		); err != nil {
			return nil, err
		}
		results = append(results, info)
	}
	return results, nil
}
