// semantic_embedding_match.go
// Builds the one meaning-based distance a row has across every embedding its dataset stores.
// Bridges the AI search stage and the vector listing with the general row embedding and the per-language embeddings.
// Exists so the reader's interface language only ranks a match ahead and never decides which rows are searched.
package dtt_1_row_read

import (
	"fmt"
	"strings"

	"github.com/lib/pq"
)

// semanticReaderLanguageRankFactor is the modest preference for a match found
// in the reader's own language: its distance ranks as if it were 5% shorter.
// It only orders rows. Whether a row is close enough at all is decided by its
// best distance in any language, and a clearly closer match in another
// language still ranks first.
const semanticReaderLanguageRankFactor = 0.95

// semanticResultLimit is how many rows the AI stage returns at most.
const semanticResultLimit = 10

// semanticCandidateLimit is how many nearest rows the streamed AI stage reads
// before it drops the rows the text search already lists. Reading only the
// final ten would often leave nothing: the nearest rows in meaning are usually
// the same rows the words already found.
const semanticCandidateLimit = 40

// semanticSources says which embeddings a dataset stores.
type semanticSources struct {
	// General is the embedding_vector column on the dataset's own rows.
	General bool
	// Language is the per-language <dataset>_lang_embeddings table.
	Language bool
}

func (sources semanticSources) any() bool {
	return sources.General || sources.Language
}

// relatedSemanticHits keeps, in order, the hits close enough in meaning to
// count as related: at most cutoff, the configured model's cosine distance.
// Both the streamed AI stage and the one-shot answer use it, so a row the
// model does not relate to the query never reaches the reader.
func relatedSemanticHits(hits []rowSemanticScore, cutoff float64) []rowSemanticScore {
	related := make([]rowSemanticScore, 0, len(hits))
	for _, hit := range hits {
		if hit.DistanceScore <= cutoff {
			related = append(related, hit)
		}
	}
	return related
}

// resolveSemanticSources reads which embeddings the dataset stores. The
// language table counts only when the dataset is flagged for it and the table
// really exists, so a flag left without its table cannot fail the search.
func resolveSemanticSources(db rowQueryer, tableName string) (semanticSources, error) {
	general, err := hasEmbeddingVectorColumn(db, tableName)
	if err != nil {
		return semanticSources{}, fmt.Errorf("general embedding column: %w", err)
	}
	flagged, err := tableHasLangEmbeddings(db, tableName)
	if err != nil {
		return semanticSources{}, fmt.Errorf("language embedding flag: %w", err)
	}
	language := false
	if flagged {
		if err := db.QueryRow(
			`SELECT to_regclass($1) IS NOT NULL`,
			"public."+quoteDerivedTableName(tableName, "_lang_embeddings"),
		).Scan(&language); err != nil {
			return semanticSources{}, fmt.Errorf("language embedding table: %w", err)
		}
	}
	return semanticSources{General: general, Language: language}, nil
}

// readerContentLanguage maps the reader's interface language to the code a
// language embedding is stored under. It follows the interface's own mapping
// of Chinese variants: Cantonese and Hong Kong or Macau Chinese to yue, other
// Chinese to ch. Anything unrecognised gives no preference at all.
func readerContentLanguage(interfaceLanguage string) string {
	normalized := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(interfaceLanguage, "_", "-")))
	switch {
	case normalized == "":
		return ""
	case normalized == "yue" || strings.HasPrefix(normalized, "yue-"),
		normalized == "zh-hk" || normalized == "zh-mo",
		strings.HasPrefix(normalized, "zh-hant-hk") || strings.HasPrefix(normalized, "zh-hant-mo"):
		return "yue"
	case normalized == "ch" || normalized == "zh" || strings.HasPrefix(normalized, "zh-"):
		return "ch"
	}
	primary := strings.SplitN(normalized, "-", 2)[0]
	if len(primary) < 2 || len(primary) > 3 {
		return ""
	}
	for _, r := range primary {
		if r < 'a' || r > 'z' {
			return ""
		}
	}
	return primary
}

// semanticMatchLateral returns the body of a LATERAL subquery that gives one
// row of tableName its best cosine distance to the query vector across every
// embedding the dataset stores (distance), the score it ranks by
// (rank_score) and the language of that ranking match (language_code; empty
// for the general embedding). A row without a comparable embedding gets NULLs.
//
// Cosine distance ignores vector length, so vectors a provider scales to length
// one and vectors it does not are measured alike; the related-enough cut-off
// is per model (ai_features.SemanticDistanceCutoff).
// Embeddings of another length than the query vector are skipped, so vectors
// left by an earlier model cannot make the whole search fail. The reader's
// language is bound at languagePlaceholder and used only when the dataset has
// language embeddings.
func semanticMatchLateral(tableName string, sources semanticSources, vectorPlaceholder, languagePlaceholder int) string {
	quotedTable := pq.QuoteIdentifier(tableName)
	queryVector := fmt.Sprintf("$%d::vector", vectorPlaceholder)

	matches := make([]string, 0, 2)
	if sources.General {
		matches = append(matches, fmt.Sprintf(`
			SELECT %[1]s.embedding_vector <=> %[2]s AS distance,
			       ''::text AS language_code,
			       1.0::float8 AS rank_factor
			WHERE %[1]s.embedding_vector IS NOT NULL
			  AND vector_dims(%[1]s.embedding_vector) = vector_dims(%[2]s)`,
			quotedTable, queryVector))
	}
	if sources.Language {
		matches = append(matches, fmt.Sprintf(`
			SELECT language_embedding.embedding <=> %[2]s,
			       COALESCE(language_embedding.language_code, ''),
			       CASE WHEN language_embedding.language_code = $%[4]d
			            THEN %[5]g::float8 ELSE 1.0::float8 END
			FROM %[3]s AS language_embedding
			WHERE language_embedding.host_row_id = %[1]s.id
			  AND language_embedding.embedding IS NOT NULL
			  AND vector_dims(language_embedding.embedding) = vector_dims(%[2]s)`,
			quotedTable,
			queryVector,
			quoteDerivedTableName(tableName, "_lang_embeddings"),
			languagePlaceholder,
			semanticReaderLanguageRankFactor))
	}
	if len(matches) == 0 {
		// No embeddings: every row gets NULLs, which callers leave out or sort last.
		matches = append(matches, `
			SELECT NULL::float8 AS distance, NULL::text AS language_code, NULL::float8 AS rank_factor
			WHERE false`)
	}

	return fmt.Sprintf(`
		SELECT min(semantic_match.distance) AS distance,
		       min(semantic_match.distance * semantic_match.rank_factor) AS rank_score,
		       (array_agg(semantic_match.language_code
		                  ORDER BY semantic_match.distance * semantic_match.rank_factor,
		                           semantic_match.distance))[1] AS language_code
		FROM (%s
		) AS semantic_match`, strings.Join(matches, "\n\t\t\tUNION ALL"))
}
