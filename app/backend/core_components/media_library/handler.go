// handler.go
// Provides bounded image selection, attachment, and detachment HTTP endpoints.
// Between authenticated API requests, existing asset relations, and role-scoped transactions.
// Exists to keep every metadata and write operation behind the same server authorization.
package media_library

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtimepaths"
	"encoding/json"
	"errors"
	"github.com/lib/pq"
	"io"
	"net/http"
	"strconv"
)

func respondError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "media_reuse_failed"
	if errors.Is(err, ErrUnsupported) {
		status = http.StatusConflict
		message = ErrUnsupported.Error()
	}
	if errors.Is(err, ErrDenied) {
		status = http.StatusForbidden
		message = ErrDenied.Error()
	}
	if errors.Is(err, ErrConflict) {
		status = http.StatusConflict
		message = ErrConflict.Error()
	}
	httpresponse.RespondWithError(w, status, message)
}
func decodeRequest(r *http.Request) (Request, error) {
	var req Request
	d := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		return req, ErrDenied
	}
	if d.Decode(&struct{}{}) != io.EOF || req.Dataset == "" || req.RelationID <= 0 || req.ParentRowID <= 0 {
		return req, ErrDenied
	}
	return req, nil
}

// ListHandler returns only authorized candidates; filtering precedes the bounded
// page. No global counts, invisible filenames, storage journal, or captions leak.
func ListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, 405, "method_not_allowed")
		return
	}
	actor := dbutils.RequestActorContextFromRequest(r)
	if actor.UserID <= 1 {
		respondError(w, ErrDenied)
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		respondError(w, errors.New("transaction unavailable"))
		return
	}
	id, e := strconv.ParseInt(r.URL.Query().Get("relation_id"), 10, 64)
	if e != nil || id <= 0 {
		respondError(w, ErrDenied)
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if after < 0 {
		respondError(w, ErrDenied)
		return
	}
	var dataset string
	if e = tx.QueryRow(`SELECT p.table_name FROM public.system_foreign_key_relations_1_m f
 JOIN public.system_db_tables p ON p.table_uid=f.target_table_uid WHERE f.id=$1`, id).Scan(&dataset); e != nil {
		respondError(w, ErrDenied)
		return
	}
	rel, e := resolveRelation(tx, dataset, id)
	if e != nil {
		respondError(w, e)
		return
	}
	if e = readable(tx, actor, rel); e != nil {
		respondError(w, e)
		return
	}
	rows, e := tx.Query(`SELECT c.id FROM public.`+pq.QuoteIdentifier(rel.Child)+` c
 JOIN public.`+pq.QuoteIdentifier(rel.Parent)+` p ON p.id=c.`+pq.QuoteIdentifier(rel.ForeignKey)+`
 WHERE c.id>$1 AND c.asset_kind='image' ORDER BY c.id LIMIT 40`, after)
	if e != nil {
		respondError(w, e)
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			respondError(w, e)
			return
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		respondError(w, e)
		return
	}
	items := []Item{}
	for _, rowID := range ids {
		src, err := readSource(tx, rel, rowID)
		if err != nil {
			respondError(w, err)
			return
		}
		url := candidateURL(rel, src)
		if url == "" {
			continue
		}
		if a, shared := parseReference(src.Reference); shared && !AuthorizeStorageRead(tx, actor, a.ID, a.Filename) {
			continue
		}
		items = append(items, Item{SourceRowID: rowID, Name: sourceName(src), URL: url})
	}
	next := int64(0)
	if len(ids) == 40 {
		next = ids[len(ids)-1]
	}
	w.Header().Set("Cache-Control", "private, no-store")
	httpresponse.RespondWithJSON(w, 200, map[string]interface{}{"items": items, "next_after": next, "scope": "same_dataset_and_relation"})
}

// AttachHandler links one existing image to an existing editable parent.
func AttachHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, 405, "method_not_allowed")
		return
	}
	req, e := decodeRequest(r)
	if e != nil {
		respondError(w, e)
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		respondError(w, errors.New("transaction unavailable"))
		return
	}
	result, e := Attach(r.Context(), tx, runtimepaths.Current().StorageRoot, dbutils.RequestActorContextFromRequest(r), req)
	if e != nil {
		respondError(w, e)
		return
	}
	httpresponse.RespondWithJSON(w, 200, result)
}

// DetachHandler removes one exact use; it never removes physical image bytes.
func DetachHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, 405, "method_not_allowed")
		return
	}
	req, e := decodeRequest(r)
	if e != nil {
		respondError(w, e)
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		respondError(w, errors.New("transaction unavailable"))
		return
	}
	if e = Detach(r.Context(), tx, dbutils.RequestActorContextFromRequest(r), req); e != nil {
		respondError(w, e)
		return
	}
	httpresponse.RespondWithJSON(w, 200, map[string]bool{"detached": true, "file_retained": true})
}

// TakeSelections validates pending reuse before ordinary row insertion and removes
// the reserved property so it can never become a caller-controlled SQL column.
func TakeSelections(payload map[string]interface{}) ([]Selection, error) {
	raw, exists := payload["_existingImages"]
	delete(payload, "_existingImages")
	if !exists {
		return nil, nil
	}
	data, e := json.Marshal(raw)
	if e != nil || len(data) > 16<<10 {
		return nil, ErrDenied
	}
	var selections []Selection
	if e = json.Unmarshal(data, &selections); e != nil || len(selections) > 20 {
		return nil, ErrDenied
	}
	seen := map[Selection]bool{}
	for _, s := range selections {
		if s.RelationID <= 0 || s.SourceRowID <= 0 || seen[s] {
			return nil, ErrDenied
		}
		seen[s] = true
	}
	return selections, nil
}

// ApplySelections is also used by row creation, preserving one all-or-nothing
// request transaction instead of creating a row then attempting an unrelated save.
func ApplySelections(r *http.Request, dataset string, parentID int64, selections []Selection) error {
	if len(selections) == 0 {
		return nil
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		return errors.New("transaction unavailable")
	}
	actor := dbutils.RequestActorContextFromRequest(r)
	for _, s := range selections {
		if _, e := Attach(r.Context(), tx, runtimepaths.Current().StorageRoot, actor, Request{Dataset: dataset, ParentRowID: parentID, RelationID: s.RelationID, SourceRowID: s.SourceRowID}); e != nil {
			return e
		}
	}
	return nil
}
