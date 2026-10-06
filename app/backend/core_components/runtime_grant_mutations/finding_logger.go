// finding_logger.go
// Logs only request-relevant permission diagnostics at the ordinary INFO level.
// Keeps the full catalogue available at DEBUG through the shared level-aware logger.
package runtime_grant_mutations

import (
	"easelect/backend/core_components/logging"
	"easelect/backend/core_components/runtime_grants"
)

func logMutationFindings(result runtime_grants.ReconcileResult) {
	relevant := map[runtime_grants.Finding]bool{}
	for _, finding := range result.RequestFindings {
		relevant[finding] = true
		logging.Infof("runtime grant policy: role=%s object=%s finding=%s reason=%s", finding.Role, finding.Object, finding.Finding, finding.Reason)
	}
	for _, finding := range result.Findings {
		if !relevant[finding] && (finding.Finding == "blocker" || finding.Finding == "excess_read_reported") {
			logging.Debugf("runtime grant policy: role=%s object=%s finding=%s reason=%s", finding.Role, finding.Object, finding.Finding, finding.Reason)
		}
	}
}
