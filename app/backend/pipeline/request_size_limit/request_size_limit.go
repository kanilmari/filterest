// request_size_limit.go
// Pipeline stage that enforces request body size limits before handlers decode payloads.
// Bridges incoming requests and downstream handlers with MaxBytesReader streaming safety.
// Exists to reject oversized payloads early with HTTP 413, supporting per-endpoint limits.
package request_size_limit

import (
	"easelect/backend/core_components/httpresponse"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

const (
	defaultRequestBodyLimitMB = int64(10)
	defaultUploadBodyLimitMB  = int64(50)
)

var (
	loadLimitsOnce        sync.Once
	requestBodyLimitBytes int64
	uploadBodyLimitBytes  int64
)

// uploadHeavyHandlers lists handlers that are expected to receive larger bodies.
var uploadHeavyHandlers = map[string]bool{
	"dtt_1_row_create.AddRowMultipartHandlerWrapper":    true,
	"system_table_tools.SaveDatasetHeaderConfigHandler": true,
}

// RegisterUploadHeavyHandler marks an optional handler as using the larger upload limit.
// Between: private app activation packages -> request size limit pipeline stage.
// Why: Public Filterest builds can omit private app handler names from core code.
func RegisterUploadHeavyHandler(handlerName string) {
	if handlerName == "" {
		panic("upload-heavy handler name cannot be empty")
	}

	uploadHeavyHandlers[handlerName] = true
}

// WithRequestSizeLimit applies body size limits for state-changing requests.
// Between: HTTP request body reader -> downstream handler body parsing.
// Why: Prevents oversized payloads from exhausting server resources.
func WithRequestSizeLimit(handlerName string, next http.HandlerFunc) http.HandlerFunc {
	loadLimitsOnce.Do(loadLimitsFromEnv)

	return func(w http.ResponseWriter, r *http.Request) {
		if !methodCanHaveBody(r.Method) {
			next.ServeHTTP(w, r)
			return
		}

		limitBytes := requestBodyLimitBytes
		if uploadHeavyHandlers[handlerName] {
			limitBytes = uploadBodyLimitBytes
		}

		r.Body = http.MaxBytesReader(w, r.Body, limitBytes)

		if r.ContentLength > limitBytes {
			httpresponse.RespondWithError(
				w,
				http.StatusRequestEntityTooLarge,
				fmt.Sprintf(
					"request body too large: limit is %d MB",
					limitBytes/(1<<20),
				),
			)
			return
		}

		next.ServeHTTP(w, r)
	}
}

func methodCanHaveBody(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func loadLimitsFromEnv() {
	requestBodyLimitBytes = parseLimitMBEnv("REQUEST_BODY_LIMIT_MB", defaultRequestBodyLimitMB)
	uploadBodyLimitBytes = parseLimitMBEnv("REQUEST_BODY_UPLOAD_LIMIT_MB", defaultUploadBodyLimitMB)

	if uploadBodyLimitBytes < requestBodyLimitBytes {
		log.Printf(
			"\033[33mwarning: REQUEST_BODY_UPLOAD_LIMIT_MB is lower than REQUEST_BODY_LIMIT_MB; using %d MB for both\033[0m",
			requestBodyLimitBytes/(1<<20),
		)
		uploadBodyLimitBytes = requestBodyLimitBytes
	}
}

func parseLimitMBEnv(key string, defaultMB int64) int64 {
	rawValue := strings.TrimSpace(os.Getenv(key))
	if rawValue == "" {
		return defaultMB << 20
	}

	parsedMB, err := strconv.ParseInt(rawValue, 10, 64)
	if err != nil || parsedMB <= 0 || parsedMB > (math.MaxInt64>>20) {
		log.Printf(
			"\033[31merror: invalid %s=%q, using default %d MB\033[0m",
			key,
			rawValue,
			defaultMB,
		)
		return defaultMB << 20
	}

	return parsedMB << 20
}
