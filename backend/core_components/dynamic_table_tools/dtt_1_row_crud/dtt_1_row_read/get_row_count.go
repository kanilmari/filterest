// get_row_count.go
// Returns the row count for a given table along with geometry column metadata.
// Bridges the dynamic table, access-control column settings, and the frontend count display.
// Exists to provide a filtered row count respecting user role and visibility rules.

package dtt_1_row_read

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/lib/pq"

	auth "easelect/backend/core_components/auth"
	"easelect/backend/core_components/dbutils"
	e_sessions "easelect/backend/core_components/sessions"
)

/* -----------------------------------------------------------------
 *  Tuetut paikkatietotyypit – laajenna tarvittaessa
 * ----------------------------------------------------------------*/
var geoUDTNames = []string{"geometry", "geography", "point"}

/* -----------------------------------------------------------------
 *  JSON-vastausrakenne
 * ----------------------------------------------------------------*/
type tableMetaResponse struct {
	RowCount    int      `json:"row_count"`
	HasGeo      bool     `json:"has_geo"`
	GeomColumns []string `json:"geom_columns"`
	GeomSources []string `json:"geom_sources"`
}

/* -----------------------------------------------------------------
 *  /api/get-row-count?dataset=taulun_nimi
 * ----------------------------------------------------------------*/
func GetRowCountHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing dataset parameter")
		return
	}

	/* ---------- 1. Sessio & rooli ---------- */
	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "Unauthorized: login required")
		return
	}
	session, sessErr := e_sessions.GetOrCreateSession(nil, r)
	if sessErr != nil {
		log.Printf("\033[31merror: %s\033[0m\n", sessErr.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching session")
		return
	}
	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}

	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(r.Context(), tableName, currentDb)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error initializing pilot read transaction")
		return
	}

	/* ---------- 2. Rivimäärä ---------- */
	rowCount, err := getACLFilteredRowCount(readQuerier, currentDb, tableName, userRole, userID)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error counting rows")
		return
	}

	/* ---------- 3. Paikkatietostatukset ---------- */
	geomCols, err := getGeometryColumns(currentDb, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching geo columns")
		return
	}
	geomSrcs, err := getGeometrySourceTables(currentDb, tableName)
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching geo sources")
		return
	}
	hasGeo := len(geomCols) > 0 || len(geomSrcs) > 0

	/* ---------- 4. JSON-vastaus ---------- */
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(tableMetaResponse{
		RowCount:    rowCount,
		HasGeo:      hasGeo,
		GeomColumns: geomCols,
		GeomSources: geomSrcs,
	})
}

/* -----------------------------------------------------------------
 *  Rivimäärän haku
 * ----------------------------------------------------------------*/
func getACLFilteredRowCount(readQuerier dbutils.Querier, metadataDB *sql.DB, tableName, userRole string, userID int) (int, error) {
	readPolicy, err := getLegacyMustTrueReadPolicy(metadataDB, tableName)
	if err != nil {
		return 0, fmt.Errorf("error fetching row policy metadata: %w", err)
	}
	return getRowCountWithReadPolicy(readQuerier, tableName, userRole, userID, readPolicy)
}

// getRowCountWithMustTrue laskee rivimäärän valmiiksi haetuilla
// mustTrueCols + ownerColumn arvoilla.
func getRowCountWithMustTrue(db dbutils.Querier, tableName, userRole string, userID int, mustTrueCols []string, ownerColumn string) (int, error) {
	return getRowCountWithReadPolicy(db, tableName, userRole, userID, legacyMustTrueReadPolicy(mustTrueCols, ownerColumn))
}

// getRowCountWithReadPolicy counts rows after applying the active read-row policy.
// It exists so count queries share the same policy object as row fetch and intelligent hydration.
func getRowCountWithReadPolicy(db dbutils.Querier, tableName, userRole string, userID int, readPolicy ReadRowPolicy) (int, error) {
	safe := pq.QuoteIdentifier(tableName)

	where := ""
	args := make([]interface{}, 0, 1)
	readPolicyCond, readPolicyArgs := buildReadRowPolicyCondition(
		tableName,
		userRole,
		userID,
		readPolicy,
		1,
	)
	if readPolicyCond != "" {
		where = " WHERE " + readPolicyCond
		args = append(args, readPolicyArgs...)
	}

	query := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", safe, where)

	var cnt int
	if err := db.QueryRow(query, args...).Scan(&cnt); err != nil {
		return 0, fmt.Errorf("error counting rows: %w", err)
	}
	return cnt, nil
}

/* -----------------------------------------------------------------
 *  1) Suorat geo-sarakkeet
 * ----------------------------------------------------------------*/
func getGeometryColumns(db *sql.DB, tableName string) ([]string, error) {
	const query = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $1
          AND udt_name = ANY($2)`
	rows, err := db.Query(query, tableName, pq.Array(geoUDTNames))
	if err != nil {
		return nil, fmt.Errorf("querying geo columns: %w", err)
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, fmt.Errorf("scanning geo column: %w", err)
		}
		cols = append(cols, columnName)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in getGeometryColumns: %w", err)
	}
	return cols, nil
}

/* -----------------------------------------------------------------
 *  2) FK-viittaukset tauluista, joilla on geo-sarakkeita
 *     → Jos jokin geo-taulu viittaa tähän tauluun, merkitään se
 *       lokaatiotauluksi (hasGeo = true)
 * ----------------------------------------------------------------*/
func getGeometrySourceTables(db *sql.DB, tableName string) ([]string, error) {
	const query = `
        SELECT DISTINCT tc.table_name
        FROM information_schema.table_constraints        tc
        JOIN information_schema.key_column_usage         kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage  ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name   = $1          -- 🔸 viittauskohde = nykyinen taulu
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_name = tc.table_name
                AND udt_name   = ANY($2)     -- 🔸 viittaavalla taululla geo-sarake
          );`
	rows, err := db.Query(query, tableName, pq.Array(geoUDTNames))
	if err != nil {
		return nil, fmt.Errorf("querying referencing geo tables: %w", err)
	}
	defer rows.Close()

	var srcs []string
	for rows.Next() {
		var sourceTable string
		if err := rows.Scan(&sourceTable); err != nil {
			return nil, fmt.Errorf("scanning referencing geo table: %w", err)
		}
		srcs = append(srcs, sourceTable)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in getGeometrySourceTables: %w", err)
	}
	return srcs, nil
}
