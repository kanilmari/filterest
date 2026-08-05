// intelligent_result_handler.go
// Orchestrates intelligent search by combining full-text and optional vector search.
// Bridges the search query, the FTS/vector fetchers, and the HTTP response (blocking or streaming).
// Exists to merge results from both search sources ranked by semantic distance.

package dtt_1_row_read

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/httpresponse"

	auth "easelect/backend/core_components/auth"
	e_sessions "easelect/backend/core_components/sessions"
)

type rowSemanticScore struct {
	RowID         int
	RowName       string
	DistanceScore float64
}

type rowTextRank struct {
	RowID   int
	RowName string
	Rank    float64
}

// prioritizeNumericIDResultFirst preserves merged intelligent-search ordering while pinning an exact id match first.
// It exists between fetch-ranked candidate ids and row loading so numeric searches behave like direct row lookup.
func prioritizeNumericIDResultFirst(rowOrder []int, numericID int, hasNumericID bool) []int {
	if !hasNumericID || len(rowOrder) < 2 || rowOrder[0] == numericID {
		return rowOrder
	}
	out := make([]int, 0, len(rowOrder))
	for _, id := range rowOrder {
		if id == numericID {
			out = append(out, id)
			break
		}
	}
	if len(out) == 0 {
		return rowOrder
	}
	for _, id := range rowOrder {
		if id != numericID {
			out = append(out, id)
		}
	}
	return out
}

/* ===========================================================
 *  HTTP-kääre
 * =========================================================*/

func GetIntelligentResultsHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET accepted")
		return
	}

	// 🔄 UUSI: jos stream‑parametri, käytä virtaavaa vastausta
	if r.URL.Query().Get("stream") == "1" {
		if err := queryIntelligentResultsStream(w, r); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}

	// Vanha, blokkaava versio (muuttumaton)
	if err := queryIntelligentResults(w, r); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "internal error")
	}
}

/* ===========================================================
 *  UUSI FUNKTIO: virtaava vastaus kahdessa erässä ✅
 * =========================================================*/
func queryIntelligentResultsStream(w http.ResponseWriter, r *http.Request) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming unsupported by server")
	}

	//------------------------------------------------
	// 1. Nopea täyden tekstin haku
	//------------------------------------------------
	tableName := r.URL.Query().Get("dataset")
	userQuery := r.URL.Query().Get("query")
	lang := r.URL.Query().Get("lang")
	if tableName == "" || userQuery == "" {
		return fmt.Errorf("table or query parameter missing")
	}
	numericID, hasNumericID := parseNumericIDSearch(strings.TrimSpace(userQuery))

	session, _ := e_sessions.GetOrCreateSession(nil, r)
	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}
	userID, _ := e_sessions.GetUserIDFromSession(r)
	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(r.Context(), tableName, currentDb)
	if err != nil {
		return fmt.Errorf("pilot read transaction init: %w", err)
	}

	textHits, err := fetchFullTextRows(readQuerier, tableName, userQuery)
	if err != nil {
		return fmt.Errorf("full‑text search failed: %w", err)
	}
	var order []int
	textHitIDs := make(map[int]bool)
	for _, h := range textHits {
		order = append(order, h.RowID)
		textHitIDs[h.RowID] = true
	}
	order = prioritizeNumericIDResultFirst(order, numericID, hasNumericID)
	readPolicy, err := getLegacyMustTrueReadPolicy(currentDb, tableName)
	if err != nil {
		return fmt.Errorf("row policy metadata fetch: %w", err)
	}

	textRows, textCols, err := fetchRowsInOrder(readQuerier, tableName, order, userRole, userID, readPolicy)
	if err != nil {
		return fmt.Errorf("fetchRowsInOrder(text): %w", err)
	}
	if r.URL.Query().Get("include_card_support") == "1" {
		logCardSupportEnrichmentWarning(
			tableName,
			enrichRowsWithCardSupportColumns(readQuerier, tableName, textRows, nil, textCols),
		)
	}
	types, err := getColumnDataTypesWithFK(tableName, currentDb)
	if err != nil {
		return fmt.Errorf("getColumnDataTypesWithFK: %w", err)
	}
	types = enrichServiceCatalogModerationDataTypes(tableName, types)

	//------------------------------------------------
	// 2. Lähetä ensimmäinen paketti (stage="text")
	//------------------------------------------------
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	first := map[string]interface{}{
		"stage":   "text",
		"columns": textCols,
		"data":    textRows,
		"types":   types,
	}
	if err := json.NewEncoder(w).Encode(first); err != nil {
		return err
	}
	flusher.Flush()

	//------------------------------------------------
	// 3. Embedding-haku — vain tulokset joita EI ole teksti-osumissa
	//------------------------------------------------
	embeddingsPresent := false
	if ok, err := tableHasLangEmbeddings(readQuerier, tableName); err == nil && ok {
		embeddingsPresent = true
	} else {
		embeddingsPresent, _ = hasEmbeddingVectorColumn(readQuerier, tableName)
	}

	if embeddingsPresent {
		vec, vErr := generateVectorParam(userQuery)
		if vErr != nil {
			fmt.Printf("\033[31membedding vector error: %s\033[0m\n", vErr.Error())
		} else {
			semanticHits, sErr := fetchSimilarRows(readQuerier, tableName, lang, vec)
			if sErr != nil {
				fmt.Printf("\033[31membedding search error: %s\033[0m\n", sErr.Error())
			} else {
				// Filter out rows already found by text search
				const semanticThreshold = 0.70
				var aiOrder []int
				for _, hit := range semanticHits {
					if !textHitIDs[hit.RowID] && hit.DistanceScore <= semanticThreshold {
						aiOrder = append(aiOrder, hit.RowID)
					}
				}
				if len(aiOrder) > 0 {
					aiRows, aiCols, aErr := fetchRowsInOrder(readQuerier, tableName, aiOrder, userRole, userID, readPolicy)
					if aErr != nil {
						fmt.Printf("\033[31mfetchRowsInOrder(ai): %s\033[0m\n", aErr.Error())
					} else {
						if r.URL.Query().Get("include_card_support") == "1" {
							logCardSupportEnrichmentWarning(
								tableName,
								enrichRowsWithCardSupportColumns(readQuerier, tableName, aiRows, nil, aiCols),
							)
						}
						cols := aiCols
						if len(cols) == 0 {
							cols = textCols
						}
						aiPacket := map[string]interface{}{
							"stage":   "ai",
							"columns": cols,
							"data":    aiRows,
							"types":   types,
						}
						if err := json.NewEncoder(w).Encode(aiPacket); err != nil {
							return err
						}
						flusher.Flush()
					}
				}
			}
		}
	}

	return nil
}

/* ===========================================================
 *  FUNKTIO: executeInternalIntelligentQuery ✅
 *  (käyttää valmista queryIntelligentResults‑logiikkaa sisäisesti
 *   eikä duplicoi massiivista koodia — näin pidämme yhden lähteen totuudelle)
 * =========================================================*/
func executeInternalIntelligentQuery(r *http.Request, tableName, userQuery string, columnDataTypes map[string]interface{}) (map[string]interface{}, error) {
	// Tehdään kopio pyynnöstä, jotta alkuperäiseen ei kajota
	clone := r.Clone(r.Context())
	q := clone.URL.Query()
	q.Set("table", tableName)
	q.Set("query", userQuery)
	// varmuuden vuoksi poistetaan mahdollinen stream‑parametri
	q.Del("stream")
	clone.URL.RawQuery = q.Encode()

	// Käytetään httptest‑recorderia kaappaamaan JSON‑vastaus
	rec := httptest.NewRecorder()
	if err := queryIntelligentResults(rec, clone); err != nil {
		return nil, err
	}

	// Parsitaan runko mapiksi
	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		return nil, fmt.Errorf("cannot parse internal JSON: %w", err)
	}

	// Varmistetaan, että columnDataTypes menee mukana (voi olla jo siellä)
	if _, ok := parsed["types"]; !ok {
		parsed["types"] = columnDataTypes
	}
	return parsed, nil
}

/* ===========================================================
 *  Päätefunktio – älykäs (mutta kevyt) haku
 *  • 1) täysi teksti  • 2) vektorit (jos sarake löytyy)
 *  • Kirjaa lokiin, mistä rivit tulivat ja millaisin arvoin
 * =========================================================*/
func queryIntelligentResults(w http.ResponseWriter, r *http.Request) error {
	const semanticThreshold = 0.70

	//------------------------------------------------
	// 1. Input ja sessiorooli
	//------------------------------------------------
	tableName := r.URL.Query().Get("dataset")
	userQuery := strings.TrimSpace(r.URL.Query().Get("query"))
	lang := r.URL.Query().Get("lang")
	if tableName == "" || userQuery == "" {
		return fmt.Errorf("table or query parameter missing")
	}
	numericID, hasNumericID := parseNumericIDSearch(userQuery)

	session, _ := e_sessions.GetOrCreateSession(nil, r)
	userRole, _ := session.Values["user_role"].(string)
	if userRole == "" {
		userRole = "guest"
	}
	userID, _ := e_sessions.GetUserIDFromSession(r)
	currentDb := auth.GetDBForRole(userRole)
	readQuerier, err := getPilotReadQuerier(r.Context(), tableName, currentDb)
	if err != nil {
		return fmt.Errorf("pilot read transaction init: %w", err)
	}

	//------------------------------------------------
	// 2. Tarkista löytyykö embeddings-sarake
	//------------------------------------------------
	embeddingsPresent := false
	if ok, err := tableHasLangEmbeddings(readQuerier, tableName); err == nil && ok {
		embeddingsPresent = true
	} else {
		var embErr error
		embeddingsPresent, embErr = hasEmbeddingVectorColumn(readQuerier, tableName)
		if embErr != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", embErr.Error())
			embeddingsPresent = false
		}
	}

	//------------------------------------------------
	// 3. Kerää kandidaatit + kerää lokia varten raakadata
	//------------------------------------------------
	type candidate struct {
		RowID    int
		RowName  string
		SemDist  float64
		HasSem   bool
		ExactHit bool
		Rank     float64
	}
	candidates := make(map[int]*candidate)

	/* A) Täysi teksti --------------------------------------------------*/
	textHits, textErr := fetchFullTextRows(readQuerier, tableName, userQuery)
	if textErr != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", textErr.Error())
	}

	for _, hit := range textHits {
		c := candidates[hit.RowID]
		if c == nil {
			c = &candidate{RowID: hit.RowID, RowName: hit.RowName}
			candidates[hit.RowID] = c
		}
		c.ExactHit = true
		c.Rank = hit.Rank
	}

	/* B) Embeddings ----------------------------------------------------*/
	var semanticHits []rowSemanticScore
	if embeddingsPresent {
		vec, vErr := generateVectorParam(userQuery)
		if vErr != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", vErr.Error())
		} else {
			semanticHits, err = fetchSimilarRows(readQuerier, tableName, lang, vec)
			if err != nil {
				fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			} else {
				for _, near := range semanticHits {
					c := candidates[near.RowID]
					if c == nil {
						c = &candidate{RowID: near.RowID, RowName: near.RowName}
						candidates[near.RowID] = c
					}
					c.HasSem = true
					c.SemDist = near.DistanceScore
				}
			}
		}
	}

	/* 🔎 Kirjataan lokiin, mistä rivit tulivat ja arvoillaan -----------*/
	logSearchDiagnostics(userQuery, textHits, semanticHits, embeddingsPresent)

	if len(candidates) == 0 {
		return writeEmptyResultJSON(w)
	}

	//------------------------------------------------
	// 4. Järjestä paremmuus – ensin semanttisesti lähellä, sitten muut
	//------------------------------------------------
	var near, far []rowSemanticScore
	for _, c := range candidates {
		if c.HasSem && c.SemDist <= semanticThreshold {
			near = append(near, rowSemanticScore{RowID: c.RowID, RowName: c.RowName, DistanceScore: c.SemDist})
		} else {
			far = append(far, rowSemanticScore{RowID: c.RowID, RowName: c.RowName, DistanceScore: c.SemDist})
		}
	}
	sort.SliceStable(near, func(i, j int) bool { return near[i].DistanceScore < near[j].DistanceScore })
	sort.SliceStable(far, func(i, j int) bool { return far[i].DistanceScore < far[j].DistanceScore })

	rowOrder := make([]int, 0, len(near)+len(far))
	for _, c := range near {
		rowOrder = append(rowOrder, c.RowID)
	}
	for _, c := range far {
		rowOrder = append(rowOrder, c.RowID)
	}
	rowOrder = prioritizeNumericIDResultFirst(rowOrder, numericID, hasNumericID)

	//------------------------------------------------
	// 5. Hae rivit ja metatiedot
	//------------------------------------------------
	columnDataTypes, err := getColumnDataTypesWithFK(tableName, currentDb)
	if err != nil {
		return fmt.Errorf("getColumnDataTypesWithFK: %w", err)
	}
	columnDataTypes = enrichServiceCatalogModerationDataTypes(tableName, columnDataTypes)

	readPolicy, err := getLegacyMustTrueReadPolicy(currentDb, tableName)
	if err != nil {
		return fmt.Errorf("row policy metadata fetch: %w", err)
	}

	rowsJSON, resultColumns, err := fetchRowsInOrder(readQuerier, tableName, rowOrder, userRole, userID, readPolicy)
	if err != nil {
		return fmt.Errorf("fetchRowsInOrder: %w", err)
	}
	if r.URL.Query().Get("include_card_support") == "1" {
		logCardSupportEnrichmentWarning(
			tableName,
			enrichRowsWithCardSupportColumns(readQuerier, tableName, rowsJSON, nil, resultColumns),
		)
	}

	//------------------------------------------------
	// 6. results_per_load
	//------------------------------------------------
	var resultsPerLoadStr string
	err = currentDb.QueryRow(`
		SELECT int_value
		FROM system_config
		WHERE key = 'results_load_amount'`).Scan(&resultsPerLoadStr)
	if err != nil {
		return fmt.Errorf("config fetch error: %w", err)
	}
	resultsPerLoad, _ := strconv.Atoi(resultsPerLoadStr)

	//------------------------------------------------
	// 7. JSON-vastaus
	//------------------------------------------------
	respJSON := map[string]interface{}{
		"columns":        resultColumns,
		"data":           rowsJSON,
		"types":          columnDataTypes,
		"resultsPerLoad": resultsPerLoad,
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(respJSON)
}

/* ===========================================================
 *  Apuri: kirjaa hakutulokset lokiin ✅
 * =========================================================*/
func logSearchDiagnostics(userQuery string, textHits []rowTextRank, semHits []rowSemanticScore, embeddingsPresent bool) {
	fmt.Println("--------------------------------------------------------")
	fmt.Printf("🔍 Search query: %q\n", userQuery)

	// Tekstihaun tulokset
	if len(textHits) == 0 {
		fmt.Println("✏️  Full text: no matches.")
	} else {
		fmt.Printf("✏️  Full text — %d matches:\n", len(textHits))
		for _, h := range textHits {
			fmt.Printf("    • id=%d name=%s (rank=%.4f)\n", h.RowID, h.RowName, h.Rank)
		}
	}

	// Embedding-tulokset
	if !embeddingsPresent {
		fmt.Println("🧩 Embedding search: column missing, skipping.")
	} else if len(semHits) == 0 {
		fmt.Println("🧩 Embedding search: no matches.")
	} else {
		fmt.Printf("🧩 Embedding search — %d matches:\n", len(semHits))
		for _, s := range semHits {
			fmt.Printf("    • id=%d name=%s (distance=%.4f)\n", s.RowID, s.RowName, s.DistanceScore)
		}
	}
	fmt.Println("--------------------------------------------------------")
}

/* ===========================================================
 *  JSON-apuri tyhjille tuloksille
 * =========================================================*/

func writeEmptyResultJSON(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	empty := map[string]interface{}{
		"columns":        []string{},
		"data":           []map[string]interface{}{},
		"types":          map[string]interface{}{},
		"resultsPerLoad": 0,
	}
	return json.NewEncoder(w).Encode(empty)
}
