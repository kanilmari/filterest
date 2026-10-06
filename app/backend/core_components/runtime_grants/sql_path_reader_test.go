// sql_path_reader_test.go
// Holds reviewed definer fingerprints to their newest product migration bodies.
// Shares exact migration SQL with the disposable PostgreSQL audit tests.
// Prevents an earlier migration or a copied fixture from becoming the authority.
package runtime_grants

import (
	"crypto/md5"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestReviewedDefinerBodiesMatchNewestMigrations(t *testing.T) {
	for digest, identity := range reviewedDefinerBodies {
		_, body, migration := newestDefinerMigrationFunction(t, identity)
		if got := fmt.Sprintf("%x", md5.Sum([]byte(body))); got != digest {
			t.Errorf("%s: %s.%s body requires review: got %s, listed %s", filepath.Base(migration), identity.Schema, identity.Name, got, digest)
		}
	}
}

// Extract the complete CREATE statement and untrimmed dollar-quoted body from
// the newest migration defining this function. Never execute the migration's
// other statements in the audit fixture.
func newestDefinerMigrationFunction(t *testing.T, identity definerFunctionIdentity) (definition, body, migration string) {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "server_tools", "migrations", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+` + regexp.QuoteMeta(identity.Schema+"."+identity.Name) + `\s*\([^;]*?\bAS\s+(\$(?:[a-z_][a-z_0-9]*)?\$)`)
	// Glob returns migration filenames in lexical order, matching their timestamps.
	for i := len(files) - 1; i >= 0; i-- {
		data, err := os.ReadFile(files[i])
		if err != nil {
			t.Fatal(err)
		}
		source := string(data)
		matches := pattern.FindAllStringSubmatchIndex(source, -1)
		if len(matches) == 0 {
			continue
		}
		match := matches[len(matches)-1]
		delimiter := source[match[2]:match[3]]
		bodyEnd := strings.Index(source[match[1]:], delimiter)
		if bodyEnd < 0 {
			t.Fatalf("%s: unterminated function body", files[i])
		}
		bodyEnd += match[1]
		statementEnd := bodyEnd + len(delimiter)
		terminator := regexp.MustCompile(`^\s*;`).FindString(source[statementEnd:])
		if terminator == "" {
			t.Fatalf("%s: missing function statement terminator", files[i])
		}
		return source[match[0] : statementEnd+len(terminator)], source[match[1]:bodyEnd], files[i]
	}
	t.Fatalf("no product migration defines %s.%s", identity.Schema, identity.Name)
	return "", "", ""
}
