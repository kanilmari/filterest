// publication_details_validator.go
// Validates scheduling, reader copy and publication evidence before mutation.
// Connects release-goal HTTP requests with the additive publication schema.
// Keeps the software version as text and the existing contract version independent.
package workline_observatory

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Migration 70's ck_dev_agent_release_goals_publication uses these UTC limits.
// TestPublicationTimeConstraintAgreementPostgres proves the bounds and rounding.
var publicationTimeMinimum = time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
var publicationTimeLimit = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
var publicationInstantPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$`)

type publicationDetails struct {
	PublicationVersion string  `json:"publication_version"`
	TargetDate         *string `json:"target_date"`
	ReaderDescription  string  `json:"reader_description"`
	Published          bool    `json:"published"`
	PublishedAt        *string `json:"published_at"`
}

// normalizePublicationDetails accepts calendar dates and timezone-qualified instants.
// A published row without an explicit time uses the server's clock on creation,
// or keeps its original time on update. Unpublishing requires clearing the time.
func normalizePublicationDetails(input publicationDetails) (publicationDetails, error) {
	if publicationDetailsContainNUL(input) {
		return input, errors.New("invalid_publication_text")
	}
	input.PublicationVersion = strings.TrimSpace(input.PublicationVersion)
	input.ReaderDescription = strings.TrimSpace(input.ReaderDescription)
	if utf8.RuneCountInString(input.PublicationVersion) > 80 ||
		utf8.RuneCountInString(input.ReaderDescription) > 6000 ||
		(input.Published && input.PublicationVersion == "") {
		return input, errors.New("invalid_publication_details")
	}
	if input.TargetDate != nil {
		parsed, err := time.Parse(time.DateOnly, *input.TargetDate)
		if err != nil || parsed.Year() < 1 || parsed.Year() > 9999 {
			return input, errors.New("invalid_publication_target_date")
		}
	}
	if input.PublishedAt != nil {
		parsed, err := time.Parse(time.RFC3339Nano, *input.PublishedAt)
		parts := publicationInstantPattern.FindStringSubmatch(*input.PublishedAt)
		if !input.Published || err != nil || parts == nil {
			return input, errors.New("invalid_publication_time")
		}
		// PostgreSQL stores microseconds: a nanosecond instant can round across
		// either bound. Compare the stored instant, including timezone offsets.
		// PostgreSQL parses the original fraction as a double then uses rint;
		// Go's nanosecond parser truncates longer fractions, so do not round it.
		fraction := 0.0
		if parts[1] != "" {
			fraction, err = strconv.ParseFloat(parts[1], 64)
			if err != nil {
				return input, errors.New("invalid_publication_time")
			}
		}
		stored := parsed.UTC().Truncate(time.Second).Add(time.Duration(math.RoundToEven(fraction*1e6)) * time.Microsecond)
		if stored.Before(publicationTimeMinimum) || !stored.Before(publicationTimeLimit) {
			return input, errors.New("invalid_publication_time")
		}
		// Send the validated UTC microseconds, so PostgreSQL cannot reinterpret
		// permissive parser syntax or reject an otherwise valid large UTC offset.
		normalized := stored.Format(time.RFC3339Nano)
		input.PublishedAt = &normalized
	}
	return input, nil
}

func publicationDetailsContainNUL(input publicationDetails) bool {
	texts := []string{input.PublicationVersion, input.ReaderDescription}
	if input.TargetDate != nil {
		texts = append(texts, *input.TargetDate)
	}
	if input.PublishedAt != nil {
		texts = append(texts, *input.PublishedAt)
	}
	return publicationTextContainsNUL(texts...)
}

func publicationTextContainsNUL(texts ...string) bool {
	for _, text := range texts {
		if strings.ContainsRune(text, '\x00') {
			return true
		}
	}
	return false
}
