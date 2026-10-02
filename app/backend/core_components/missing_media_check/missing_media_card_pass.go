// missing_media_card_pass.go
// Reads every picture field of every dataset — the card picture and any image field — and checks its file.
// Between the gallery pass of missing_media_checker.go, the card picture rule of dtt_asset_linking
// and the unused-files walk.
// Exists because a card can show a picture no gallery row names: such a file was missed when it
// went missing, and the unused-files list could name it although a card still showed it. It also
// lists the card pictures kept from another row's folder, as the owner decided (K121, 30.9.2026).
package missing_media_check

import (
	"fmt"
	"path"
	"strconv"
	"strings"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	media_utils "easelect/backend/core_components/media_utils"

	"github.com/lib/pq"
)

// cardPassPageSize is how many picture values one statement of the card pass reads.
const cardPassPageSize = 1000

// cardPassReservedShare: one fifth of the run's row limit is kept for the card pass;
// the gallery pass plans with the rest, so the two together never exceed the limit.
const cardPassReservedShare = 5

// Card picture finding reasons, kept stable so the interface can translate them.
const (
	CardReasonMissing        = "card_picture_missing"
	CardReasonUnresolved     = "card_picture_unresolved"
	CardReasonUnchecked      = "card_picture_unchecked"
	CardReasonKeptFromFolder = "card_picture_kept_from_other_folder"
)

// CardPictureFinding is one picture field the card pass reports.
type CardPictureFinding struct {
	Dataset      string `json:"dataset"`
	RowID        int64  `json:"row_id"`
	Column       string `json:"column"`
	StoredValue  string `json:"stored_value"`
	ExpectedPath string `json:"expected_path,omitempty"`
	OwnerFolder  string `json:"owner_folder,omitempty"`
	Reason       string `json:"reason"`
}

// pictureField is one column of one dataset that can show a picture.
type pictureField struct {
	Dataset  string
	TableUID string
	Column   string
	// Gallery is the dataset's gallery, set only for its cached_image, the one field the
	// card picture rule maintains.
	Gallery *dtt_card_picture.PictureRelation
}

// runCardPass reads picture fields until every value is read, the pass's row allowance
// is spent or the run's time is up. The pass is complete only when every value was read.
func (run *checkRun) runCardPass() {
	result := run.result
	// The gallery pass planned with at most four fifths of the limit, so this is at
	// least the reserved fifth and never takes the run past the limit.
	allowance := run.settings.MaxTotalRowsChecked - result.RowsChecked
	if allowance < 0 {
		allowance = 0
	}
	fields, err := listPictureFields(run.reader)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("card pictures: listing picture fields: %v", err))
		return
	}
	complete := true
	for _, field := range fields {
		if !run.timeLeft() {
			result.TimeBudgetReached = true
			complete = false
			break
		}
		done, err := run.readPictureField(field, &allowance)
		if err != nil {
			if run.reader.timeUp() {
				result.TimeBudgetReached = true
			} else {
				result.Errors = append(result.Errors, fmt.Sprintf("card pictures of %s.%s: %v", field.Dataset, field.Column, err))
			}
			complete = false
			break
		}
		if !done {
			complete = false
			break
		}
	}
	result.CardPassComplete = complete
}

// readPictureField reads one field's non-empty values page by page. done is false when
// the allowance ran out before the field was read to its end.
func (run *checkRun) readPictureField(field pictureField, allowance *int) (bool, error) {
	column := pq.QuoteIdentifier(field.Column)
	query := fmt.Sprintf(
		`SELECT id, %s::text FROM %s WHERE id > $1 AND NULLIF(btrim(%s::text), '') IS NOT NULL ORDER BY id LIMIT %d`,
		column, pq.QuoteIdentifier(field.Dataset), column, cardPassPageSize,
	)
	lastID := int64(0)
	for {
		rows, err := run.reader.Query(query, lastID)
		if err != nil {
			return false, err
		}
		read := 0
		for rows.Next() {
			if *allowance <= 0 || !run.timeLeft() {
				rows.Close()
				if !run.timeLeft() {
					run.result.TimeBudgetReached = true
				} else {
					run.result.RowBudgetReached = true
				}
				return false, nil
			}
			var rowID int64
			var value string
			if err := rows.Scan(&rowID, &value); err != nil {
				rows.Close()
				return false, err
			}
			lastID = rowID
			read++
			*allowance--
			run.result.CardPicturesChecked++
			run.checkPictureValue(field, rowID, strings.TrimSpace(value))
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return false, err
		}
		if read < cardPassPageSize {
			return true, nil
		}
	}
}

// checkPictureValue looks for one picture field's file and records it as a reference,
// a missing picture, one that could not be checked, or a card picture kept from another
// row's folder.
func (run *checkRun) checkPictureValue(field pictureField, rowID int64, value string) {
	finding := CardPictureFinding{Dataset: field.Dataset, RowID: rowID, Column: field.Column, StoredValue: value}
	// An external address names no stored file, though its last part could pass for
	// a flat file name; there is nothing to look for.
	if links.IsExternalPictureAddress(value) {
		return
	}
	reference, resolved := ResolveCardPictureReference(value, field.TableUID, rowID)
	if !resolved {
		finding.Reason = CardReasonUnresolved
		run.recordCardFinding(&run.result.MissingCardPictures, &run.result.MissingCardPicturesCount, finding)
		return
	}
	state := media_utils.StoredPictureState(reference.RelativePaths, run.fileState)
	finding.ExpectedPath = reference.RelativePaths[0]
	finding.OwnerFolder = reference.OwnerFolder
	switch state {
	case media_utils.StoredFileMissing:
		finding.Reason = CardReasonMissing
		run.recordCardFinding(&run.result.MissingCardPictures, &run.result.MissingCardPicturesCount, finding)
		return
	case media_utils.StoredFileUnknown:
		finding.Reason = CardReasonUnchecked
		run.recordCardFinding(&run.result.UncheckedCardPictures, &run.result.UncheckedCardPicturesCount, finding)
		// A file that could not be checked may still be in use: it is a reference too.
	}
	run.addReference(reference)

	ownFolder := path.Join(field.TableUID, strconv.FormatInt(rowID, 10))
	if field.Gallery == nil || state != media_utils.StoredFileExists || reference.MediaLibrary || reference.OwnerFolder == ownFolder {
		return
	}
	// The same classification the card picture rule applies, so the check and the
	// writer can never disagree about which pictures are kept.
	references, parentTableUID, err := links.ReadParentPictureReferences(run.reader, field.Dataset, rowID)
	if err != nil {
		run.result.Errors = append(run.result.Errors, fmt.Sprintf("card picture of %s row %d: %v", field.Dataset, rowID, err))
		return
	}
	class, _ := links.ClassifyCardPicture(value, references, parentTableUID, rowID, field.Gallery.Shared, run.fileState)
	if class == dtt_card_picture.CurrentKept {
		finding.Reason = CardReasonKeptFromFolder
		run.recordCardFinding(&run.result.KeptCardPictures, &run.result.KeptCardPicturesCount, finding)
	}
}

func (run *checkRun) addReference(reference ResolvedReference) {
	if !run.settings.ReportUnusedFiles {
		return
	}
	owner := run.referencedByOwner[reference.OwnerFolder]
	if owner == nil {
		owner = map[string]bool{}
		run.referencedByOwner[reference.OwnerFolder] = owner
	}
	owner[reference.Filename] = true
}

func (run *checkRun) recordCardFinding(list *[]CardPictureFinding, count *int, finding CardPictureFinding) {
	*count++
	if len(*list) >= run.settings.MaxReportedMissing {
		run.result.CardListsTruncated = true
		return
	}
	*list = append(*list, finding)
}

// listPictureFields returns every text column of every registered dataset that can show
// a picture: the named picture fields (dtt_card_picture.CardPictureFields, the read path's
// list) and the columns whose card role is an image.
func listPictureFields(reader readOnlyQuerier) ([]pictureField, error) {
	rows, err := reader.Query(`
		SELECT t.table_name, t.table_uid::text, c.column_name
		  FROM system_db_tables t
		  JOIN information_schema.columns c
		    ON c.table_schema = 'public' AND c.table_name = t.table_name
		 WHERE c.data_type IN ('text', 'character varying')
		   AND (c.column_name = ANY($1)
		        OR EXISTS (SELECT 1 FROM system_column_details d
		                    WHERE d.table_uid = t.table_uid AND d.column_name = c.column_name
		                      AND `+dtt_card_picture.ImageRoleCondition+`))
		 ORDER BY t.table_name, c.column_name`,
		pq.Array(dtt_card_picture.CardPictureFields),
	)
	if err != nil {
		return nil, err
	}
	fields := make([]pictureField, 0)
	for rows.Next() {
		var field pictureField
		if err := rows.Scan(&field.Dataset, &field.TableUID, &field.Column); err != nil {
			rows.Close()
			return nil, err
		}
		fields = append(fields, field)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for index := range fields {
		if fields[index].Column != "cached_image" {
			continue
		}
		gallery, err := dtt_card_picture.PictureRelationOf(reader, fields[index].Dataset)
		if err != nil {
			return nil, err
		}
		fields[index].Gallery = gallery
	}
	return fields, nil
}
