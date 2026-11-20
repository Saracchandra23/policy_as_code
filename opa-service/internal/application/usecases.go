package application

import (
	"context"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

type SyncPolicyUseCase struct {
	bundle BundleRepositoryPort
}

func NewSyncPolicyUseCase(bundle BundleRepositoryPort) *SyncPolicyUseCase {
	return &SyncPolicyUseCase{bundle: bundle}
}

func (u *SyncPolicyUseCase) Execute(ctx context.Context, policy domain.PolicyDocument) (domain.Revision, error) {
	return u.bundle.Sync(ctx, policy)
}

type ValidatePolicyUseCase struct {
	decision PolicyDecisionPort
}

func NewValidatePolicyUseCase(decision PolicyDecisionPort) *ValidatePolicyUseCase {
	return &ValidatePolicyUseCase{decision: decision}
}

func (u *ValidatePolicyUseCase) Execute(ctx context.Context, rego string) error {
	return u.decision.Validate(ctx, rego)
}

type EvaluatePolicyUseCase struct {
	decision PolicyDecisionPort
}

func NewEvaluatePolicyUseCase(decision PolicyDecisionPort) *EvaluatePolicyUseCase {
	return &EvaluatePolicyUseCase{decision: decision}
}

func (u *EvaluatePolicyUseCase) Execute(ctx context.Context, request domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error) {
	return u.decision.Evaluate(ctx, request)
}

type GetPDPConfigurationUseCase struct {
	configuration domain.AuthZenConfiguration
}

func NewGetPDPConfigurationUseCase(configuration domain.AuthZenConfiguration) *GetPDPConfigurationUseCase {
	return &GetPDPConfigurationUseCase{configuration: configuration}
}

func (u *GetPDPConfigurationUseCase) Execute(context.Context) domain.AuthZenConfiguration {
	return u.configuration
}

type GetBundleUseCase struct {
	bundle BundleRepositoryPort
}

func NewGetBundleUseCase(bundle BundleRepositoryPort) *GetBundleUseCase {
	return &GetBundleUseCase{bundle: bundle}
}

func (u *GetBundleUseCase) Execute(ctx context.Context) ([]byte, domain.Revision, error) {
	return u.bundle.TarGz(ctx)
}
