// row_actor_writers_test.go
// Audits direct developer-tool INSERTs into the eight marked datasets.
// Reads SQL literals from all Go writers, including the release observatory.
// Alerts when a new pool or private-transaction writer omits either actor.
package agent_tools

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestDeveloperToolWritersNameBothActors(t *testing.T) {
	tables := map[string]int{"dev_agent_worklines": 0, "dev_agent_task_todos": 0, "dev_agent_handover_reports": 0, "dev_agent_workline_reports": 0, "dev_agent_tasks": 0, "dev_agent_task_groups": 0, "dev_agent_release_goals": 0, "dev_agent_release_goal_contracts": 0}
	insert := regexp.MustCompile(`(?is)INSERT\s+INTO\s+(dev_agent_\w+)\s*\(([^)]+)\)`)
	err := filepath.Walk("..", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			literal, ok := n.(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			sql, err := strconv.Unquote(literal.Value)
			if err != nil {
				return true
			}
			for _, match := range insert.FindAllStringSubmatch(sql, -1) {
				table := strings.ToLower(match[1])
				if _, included := tables[table]; !included {
					continue
				}
				tables[table]++
				columns := "," + strings.Join(strings.Fields(match[2]), "") + ","
				for _, actor := range []string{"created_by", "owner_id"} {
					if !strings.Contains(columns, ","+actor+",") {
						t.Errorf("%s: INSERT into %s omits %s", path, table, actor)
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for table, count := range tables {
		if count == 0 {
			t.Errorf("no writer audited for %s", table)
		}
	}
}
