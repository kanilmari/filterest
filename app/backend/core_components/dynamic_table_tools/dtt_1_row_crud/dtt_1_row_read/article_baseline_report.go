// article_baseline_report.go
// Keeps compatibility names for the shared K388 offline report contract.
// Connects the snapshot reader to tooling without making the diff import runtime code.
// The reusable report package owns all JSON fields and has no database dependencies.
package dtt_1_row_read

import report "easelect/backend/reusable_components/article_presentation_report"

type ArticleBaselineReport = report.ArticleBaselineReport
type ArticleBaselineGroup = report.ArticleBaselineGroup
type ArticleBaselineUser = report.ArticleBaselineUser
type ArticleBaselineDataset = report.ArticleBaselineDataset
type ArticleBaselineBlocks = report.ArticleBaselineBlocks
type ArticleBaselineTarget = report.ArticleBaselineTarget
type ArticleBaselineSource = report.ArticleBaselineSource
type ArticleBaselineField = report.ArticleBaselineField
type ArticleBaselineProjection = report.ArticleBaselineProjection
type ArticleBaselineIFAV = report.ArticleBaselineIFAV
type ArticleBaselineOpening = report.ArticleBaselineOpening
type ArticleBaselineReader = report.ArticleBaselineReader
type ArticleBaselineGrant = report.ArticleBaselineGrant
type ArticleBaselineAudience = report.ArticleBaselineAudience
