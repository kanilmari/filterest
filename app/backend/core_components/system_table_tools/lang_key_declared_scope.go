// lang_key_declared_scope.go
// Binds variable-prefix declarations to assignments reaching a Go return builder.
// Uses Go lexical objects so functions, closures and shadowed names stay distinct.
// Branches join proven values; escaped or unmodelled writes give no evidence.
package system_table_tools

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
)

type langKeyPrefixFlow map[*ast.Object]map[string]bool

func assignedLangKeyPrefix(path, raw string, builder []langKeyCodeLexeme, prefix string) bool {
	// Variable-prefix builders currently belong to Go producers. Other languages
	// must carry a literal prefix in their builder until they have a scoped reader.
	if filepath.Ext(path) != ".go" {
		return false
	}
	// The reviewed variable builder is a return concatenation. Fail closed for
	// other shapes until a scoped reader for that shape is supplied.
	if len(builder) < 3 || builder[0].text != "return" || builder[1].quoted || builder[2].text != "+" {
		return false
	}
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, raw, 0)
	if err != nil {
		return false
	}
	invalid := unprovableLangKeyPrefixObjects(file)
	found := false
	check := func(statement *ast.ReturnStmt, flow langKeyPrefixFlow) {
		_, tokens := lexLangKeyCode(raw[fset.Position(statement.Pos()).Offset:fset.Position(statement.End()).Offset], ".go")
		if !containsLangKeyTokens(tokens, builder) {
			return
		}
		// Match the operand of the actual return, not another identically spelled
		// variable elsewhere in the function or a nested closure.
		for _, result := range statement.Results {
			binary, ok := result.(*ast.BinaryExpr)
			if !ok || binary.Op != token.ADD {
				continue
			}
			for binaryLeft, ok := binary.X.(*ast.BinaryExpr); ok; binaryLeft, ok = binary.X.(*ast.BinaryExpr) {
				binary = binaryLeft
			}
			variable, ok := binary.X.(*ast.Ident)
			if ok && variable.Name == builder[1].text && variable.Obj != nil && flow[variable.Obj][prefix] {
				found = true
			}
		}
	}
	ast.Inspect(file, func(node ast.Node) bool {
		// Each closure starts with its own flow. The scope-wide mutation check
		// invalidates captured writes before either reader can accept evidence.
		switch function := node.(type) {
		case *ast.FuncDecl:
			if function.Body != nil {
				walkLangKeyPrefixBlock(function.Body.List, langKeyPrefixFlow{}, invalid, check)
			}
		case *ast.FuncLit:
			walkLangKeyPrefixBlock(function.Body.List, langKeyPrefixFlow{}, invalid, check)
		}
		return true
	})
	return found
}

// A value is unusable throughout its lexical scope once it escapes or has a
// write this reader cannot model. Inspect the whole AST, including closures,
// conditions and unreachable statements, before accepting any return. Lexical
// objects keep a shadowed name or an unrelated variable from poisoning a prefix.
func unprovableLangKeyPrefixObjects(root ast.Node) map[*ast.Object]bool {
	invalid := map[*ast.Object]bool{}
	invalidate := func(node ast.Node) {
		ast.Inspect(node, func(child ast.Node) bool {
			if variable, ok := child.(*ast.Ident); ok && variable.Obj != nil {
				invalid[variable.Obj] = true
			}
			return true
		})
	}
	modelledValue := func(expression ast.Expr) bool {
		switch value := expression.(type) {
		case *ast.BasicLit:
			return value.Kind == token.STRING
		case *ast.Ident:
			return true
		}
		return false
	}
	ast.Inspect(root, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.FuncLit:
			ast.Inspect(n.Body, func(child ast.Node) bool {
				assignment, ok := child.(*ast.AssignStmt)
				if !ok {
					return true
				}
				for _, lhs := range assignment.Lhs {
					ast.Inspect(lhs, func(target ast.Node) bool {
						if variable, ok := target.(*ast.Ident); ok && variable.Obj != nil {
							declaration, ok := variable.Obj.Decl.(ast.Node)
							if !ok || declaration.Pos() < n.Pos() || declaration.Pos() >= n.End() {
								invalid[variable.Obj] = true
							}
						}
						return true
					})
				}
				return true
			})
		case *ast.UnaryExpr:
			if n.Op == token.AND {
				invalidate(n.X)
			}
		case *ast.SelectorExpr:
			// Without type information, a selector may implicitly take the
			// receiver's address, including when saving a method value.
			invalidate(n.X)
		case *ast.CallExpr:
			// Do not assume an unknown callee receives a harmless value copy.
			for _, argument := range n.Args {
				invalidate(argument)
			}
		case *ast.AssignStmt:
			for i, lhs := range n.Lhs {
				_, simple := lhs.(*ast.Ident)
				if !simple || (n.Tok != token.ASSIGN && n.Tok != token.DEFINE) || len(n.Lhs) != len(n.Rhs) || !modelledValue(n.Rhs[i]) {
					invalidate(lhs)
				}
			}
		case *ast.ValueSpec:
			for i, name := range n.Names {
				if len(n.Values) > 0 && (len(n.Names) != len(n.Values) || !modelledValue(n.Values[i])) {
					invalidate(name)
				}
			}
		case *ast.DeclStmt, *ast.ReturnStmt, *ast.BlockStmt, *ast.IfStmt, *ast.ExprStmt, *ast.EmptyStmt:
			// These statements are explicitly handled by the flow reader.
		default:
			if statement, ok := node.(ast.Stmt); ok {
				// Includes defer/go, labels, branches, loops, switch/select and
				// future statement forms: their effects are never guessed.
				invalidate(statement)
			}
		}
		return true
	})
	return invalid
}

func cloneLangKeyPrefixFlow(flow langKeyPrefixFlow) langKeyPrefixFlow {
	copy := langKeyPrefixFlow{}
	for object, values := range flow {
		copy[object] = values // Value sets are immutable after assignment.
	}
	return copy
}

func mergeLangKeyPrefixFlows(a, b langKeyPrefixFlow) langKeyPrefixFlow {
	merged := cloneLangKeyPrefixFlow(a)
	for object := range a {
		if len(b[object]) == 0 {
			merged[object] = nil
		}
	}
	for object, values := range b {
		if len(a[object]) == 0 || len(values) == 0 {
			merged[object] = nil
			continue
		}
		union := map[string]bool{}
		for value := range merged[object] {
			union[value] = true
		}
		for value := range values {
			union[value] = true
		}
		merged[object] = union
	}
	return merged
}

func langKeyAssignedValues(expression ast.Expr, flow langKeyPrefixFlow) map[string]bool {
	switch value := expression.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			if text, err := strconv.Unquote(value.Value); err == nil {
				return map[string]bool{text: true}
			}
		}
	case *ast.Ident:
		return flow[value.Obj]
	}
	return nil
}

// The small flow reader accepts straight-line assignments, lexical blocks and
// if/else branches used by finite prefix producers. Unsupported control flow
// stops that path instead of guessing whether a value reaches a later builder.
func walkLangKeyPrefixBlock(statements []ast.Stmt, flow langKeyPrefixFlow, invalid map[*ast.Object]bool, check func(*ast.ReturnStmt, langKeyPrefixFlow)) (langKeyPrefixFlow, bool) {
	for _, statement := range statements {
		switch stmt := statement.(type) {
		case *ast.AssignStmt:
			values := make([]map[string]bool, len(stmt.Lhs))
			if stmt.Tok == token.ASSIGN || stmt.Tok == token.DEFINE {
				for i := range values {
					if i < len(stmt.Rhs) {
						values[i] = langKeyAssignedValues(stmt.Rhs[i], flow)
					}
				}
			}
			for i, lhs := range stmt.Lhs {
				if variable, ok := lhs.(*ast.Ident); ok && variable.Obj != nil && !invalid[variable.Obj] {
					flow[variable.Obj] = values[i]
				}
			}
		case *ast.DeclStmt:
			if declaration, ok := stmt.Decl.(*ast.GenDecl); ok {
				for _, spec := range declaration.Specs {
					if value, ok := spec.(*ast.ValueSpec); ok {
						for i, name := range value.Names {
							if i < len(value.Values) && !invalid[name.Obj] {
								flow[name.Obj] = langKeyAssignedValues(value.Values[i], flow)
							}
						}
					}
				}
			}
		case *ast.ReturnStmt:
			check(stmt, flow)
			return flow, false
		case *ast.BlockStmt:
			var reaches bool
			flow, reaches = walkLangKeyPrefixBlock(stmt.List, flow, invalid, check)
			if !reaches {
				return flow, false
			}
		case *ast.IfStmt:
			branch := cloneLangKeyPrefixFlow(flow)
			if stmt.Init != nil {
				var reaches bool
				branch, reaches = walkLangKeyPrefixBlock([]ast.Stmt{stmt.Init}, branch, invalid, check)
				if !reaches {
					return flow, false
				}
			}
			if condition, ok := stmt.Cond.(*ast.Ident); ok && condition.Obj == nil && (condition.Name == "true" || condition.Name == "false") {
				var selected []ast.Stmt
				if condition.Name == "true" {
					selected = stmt.Body.List
				} else if stmt.Else != nil {
					selected = []ast.Stmt{stmt.Else}
				}
				var reaches bool
				flow, reaches = walkLangKeyPrefixBlock(selected, branch, invalid, check)
				if !reaches {
					return flow, false
				}
				continue
			}
			yes, yesReaches := walkLangKeyPrefixBlock(stmt.Body.List, cloneLangKeyPrefixFlow(branch), invalid, check)
			no, noReaches := branch, true
			if stmt.Else != nil {
				no, noReaches = walkLangKeyPrefixBlock([]ast.Stmt{stmt.Else}, cloneLangKeyPrefixFlow(branch), invalid, check)
			}
			switch {
			case yesReaches && noReaches:
				flow = mergeLangKeyPrefixFlows(yes, no)
			case yesReaches:
				flow = yes
			case noReaches:
				flow = no
			default:
				return flow, false
			}
		case *ast.ExprStmt, *ast.EmptyStmt:
			// The scope-wide check already invalidated possible side effects.
		default:
			return flow, false
		}
	}
	return flow, true
}
