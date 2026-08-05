// add_row_handler.go
// Entry-point HTTP handler for the add-row feature.
// Bridges multipart form data from the frontend, database insertion, and file storage.
// Exists to orchestrate the full add-row flow across add_row_db and add_row_files.
package dtt_1_row_create

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"

	"easelect/backend/core_components/dbutils"
)

// AddRowMultipartHandlerWrapper hoitaa /api/add-row-multipart?dataset=... -pyyntöjä
// Between: HTTP Request -> AddRowMultipartHandler
// Why: Wrapper to handle query parameters and transaction setup for add-row requests.
func AddRowMultipartHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	tableUID := r.URL.Query().Get("table_uid")
	if tableName == "" && tableUID == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing 'dataset' or 'table_uid' query parameter")
		return
	}
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST requests are allowed")
		return
	}

	if tableName == "" {
		tx, ok := dbutils.GetTx(r.Context())
		if !ok {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
			return
		}
		name, err := getTableNameFromUID(tableUID, tx)
		if err != nil {
			fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandlerWrapper] error: %s\033[0m\n", err.Error())
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to fetch table name")
			return
		}
		tableName = name
	}

	AddRowMultipartHandler(w, r, tableName)
}

// AddRowMultipartHandler lukee multipart/form-data -pyynnön, jossa
//   - jsonPayload (lomakkeen tekstikentät JSON:na)
//   - mahdolliset tiedostot lapsitauluille (file_child_0, file_child_1, ...)
//
// Tallennuksen logiikka:
//  1. luo päärivin (RETURNING id -> mainRowID)
//  2. luo lapsirivit (RETURNING id -> childRowID) ja kerää talteen ChildInsertResult-listaan
//  3. tallentaa tiedostot polkuun: storage/<tableUID>/<mainRowID>/, nimeksi <tableUID>_<mainRowID>_<childRowID>.ext
//  4. päivittää lapsirivin "filename" (ja mahdolliset cacheTargets) samalle nimelle
//  5. Jos taulusta löytyy embedding_vector-sarake, generoi upouuden rivin teksteistä embeddingin
//     ja tallentaa sen embedding_vector-sarakkeeseen (synkronisesti).
//
// Between: HTTP Request -> Database & Filesystem
// Why: Main handler for adding a new row with potential child rows and file uploads.
func AddRowMultipartHandler(w http.ResponseWriter, r *http.Request, tableName string) {
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	err := r.ParseMultipartForm(50 << 20) // sallit. esim. 50 MB
	if err != nil {
		fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandler] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusBadRequest, "multipart parse error")
		return
	}

	tableUID, err := getTableUID(tableName, tx)
	if err != nil {
		fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandler] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "table uid not found for table")
		return
	}

	jsonPayload := r.FormValue("jsonPayload")
	if jsonPayload == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "jsonPayload is missing")
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(jsonPayload), &payload); err != nil {
		fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandler] error: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusBadRequest, "error parsing JSON")
		return
	}

	// 1) Lisätään data kantaan (pää, lapsirivit, M2M) -> saamme mainRowID + lapsirivien tiedot
	mainRowID, childInsertResults, err := insertDataAccordingToPayload(w, r, tableName, tableUID, payload, tx)
	if err != nil {
		// insertDataAccordingToPayload hoitaa virhevastausten antamisen
		return
	}

	// 2) Tallennetaan tiedostot
	if err := saveUploadedFiles(r.Context(), tx, w, r.MultipartForm.File, "storage", tableName, tableUID, mainRowID, childInsertResults); err != nil {
		return
	}

	// 3) Tarkista, onko taulussa embedding_vector-sarake -> jos kyllä, generoi embedding
	if hasEmbeddingVectorColumn(tableName, tx) {
		if errEmb := generateOpenAIEmbeddingForSingleRow(tx, tableName, mainRowID); errEmb != nil {
			fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandler -> generateOpenAIEmbeddingForSingleRow] error: %s\033[0m\n", errEmb.Error())
			// ei estä riviä toimimasta, jatketaan
		}
	}
	if tableHasLangEmbeddings(tableName, tx) {
		if errEmb := generateLangEmbeddingsForRow(tx, tableName, mainRowID, []string{"en", "fi"}); errEmb != nil {
			fmt.Printf("\033[31m[add_row_handler.go] [AddRowMultipartHandler -> generateLangEmbeddingsForRow] error: %s\033[0m\n", errEmb.Error())
		}
	}

	eventToPublish := event_bus.Event{
		Table:  tableName,
		RowID:  mainRowID,
		Action: "create",
	}
	if !dbutils.RegisterAfterCommitHook(r.Context(), func() {
		event_bus.Bus.Publish(tableName, eventToPublish)
	}) {
		// Non-lazy test/tool contexts publish immediately as a fallback.
		event_bus.Bus.Publish(tableName, eventToPublish)
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "rivi (ja tiedostot) lisätty onnistuneesti ☀️",
	})
}
