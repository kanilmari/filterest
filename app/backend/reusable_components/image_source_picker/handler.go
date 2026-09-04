// handler.go
// Exposes the protected provider list, metadata resolver, and same-origin image download endpoints.
// Bridges Filterest's authenticated request pipeline and the reusable image picker service.
// Exists so row creation can preview and import approved web images without browser-side secrets or hotlinks.
package image_source_picker

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
)

const maxRequestBytes = 16 << 10

var (
	defaultServiceOnce  sync.Once
	defaultServiceValue *Service
	serviceForRequest   = defaultService
)

func defaultService() *Service {
	defaultServiceOnce.Do(func() {
		defaultServiceValue = NewService(ConfigFromEnv())
	})
	return defaultServiceValue
}

type sourceRequest struct {
	SourceURL string `json:"source_url"`
	Purpose   string `json:"purpose,omitempty"`
}

func ProvidersHandler(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeMethodNotAllowed(writer, http.MethodGet)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"providers": serviceForRequest().Providers()})
}

func ResolveHandler(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeMethodNotAllowed(writer, http.MethodPost)
		return
	}
	payload, err := decodeSourceRequest(writer, request)
	if err != nil {
		writeAPIError(writer, err)
		return
	}
	selection, err := serviceForRequest().Resolve(request.Context(), payload.SourceURL)
	if err != nil {
		writeAPIError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"selection": selection})
}

func FileHandler(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeMethodNotAllowed(writer, http.MethodPost)
		return
	}
	payload, err := decodeSourceRequest(writer, request)
	if err != nil {
		writeAPIError(writer, err)
		return
	}
	image, selection, err := serviceForRequest().Download(request.Context(), payload.SourceURL, payload.Purpose)
	if err != nil {
		writeAPIError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", image.ContentType)
	writer.Header().Set("Content-Length", stringLength(len(image.Bytes)))
	writer.Header().Set("Content-Disposition", contentDisposition(image.Filename))
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("X-Image-Provider", selection.Provider)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(image.Bytes)
}

func decodeSourceRequest(writer http.ResponseWriter, request *http.Request) (sourceRequest, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBytes)
	defer request.Body.Close()
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var payload sourceRequest
	if err := decoder.Decode(&payload); err != nil {
		return sourceRequest{}, &resolverError{Status: http.StatusBadRequest, Code: "invalid_request", Message: "Send one JSON object containing source_url."}
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return sourceRequest{}, &resolverError{Status: http.StatusBadRequest, Code: "invalid_request", Message: "The request body must contain exactly one JSON object."}
	}
	return payload, nil
}

func writeMethodNotAllowed(writer http.ResponseWriter, method string) {
	writer.Header().Set("Allow", method)
	writeJSON(writer, http.StatusMethodNotAllowed, map[string]any{"error": map[string]string{"code": "method_not_allowed", "message": "Method not allowed."}})
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeAPIError(writer http.ResponseWriter, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "The request could not be completed."
	var typed *resolverError
	if errors.As(err, &typed) {
		status, code, message = typed.Status, typed.Code, typed.Message
	}
	writeJSON(writer, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func stringLength(value int) string {
	return fmt.Sprintf("%d", value)
}
