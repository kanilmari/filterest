// setting_write_refusal.go
// Preserves translated setting refusals through nested add-row writes.
// Connects service errors to the existing HTTP refusal contract.
// Exists so a refused child or automation cannot be reported as a server fault.
package dtt_1_row_create

import (
	"easelect/backend/core_components/httpresponse"
	"errors"
	"net/http"
)

func respondToSettingWriteError(w http.ResponseWriter, err error, fallback string) {
	var refusal *httpresponse.Refusal
	if errors.As(err, &refusal) {
		httpresponse.RespondWithRefusal(w, refusal)
		return
	}
	httpresponse.RespondWithError(w, http.StatusInternalServerError, fallback)
}
