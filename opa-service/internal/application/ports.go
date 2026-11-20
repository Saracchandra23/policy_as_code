package application

import (
	"context"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

type PolicyDecisionPort interface {
	Validate(ctx context.Context, rego string) error
	Evaluate(ctx context.Context, request domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error)
}

type BundleRepositoryPort interface {
	Sync(ctx context.Context, policy domain.PolicyDocument) (domain.Revision, error)
	Snapshot(ctx context.Context) (domain.BundleSnapshot, error)
	TarGz(ctx context.Context) ([]byte, domain.Revision, error)
}
