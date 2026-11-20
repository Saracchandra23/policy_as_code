package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/open-policy-agent/opa/v1/sdk"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

type OPAEngineAdapter struct {
	opa    *sdk.OPA
	bundle *BundleStore
	ready  <-chan struct{}
}

func NewOPAEngineAdapter(opa *sdk.OPA, bundle *BundleStore, ready <-chan struct{}) *OPAEngineAdapter {
	return &OPAEngineAdapter{opa: opa, bundle: bundle, ready: ready}
}

func (a *OPAEngineAdapter) Validate(ctx context.Context, rego string) error {
	return a.bundle.Validate(ctx, rego)
}

func (a *OPAEngineAdapter) Evaluate(ctx context.Context, request domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error) {
	if a.opa == nil {
		return domain.AccessEvaluationResponse{}, domain.ErrEngineNotReady
	}
	select {
	case <-a.ready:
	default:
		return domain.AccessEvaluationResponse{}, domain.ErrEngineNotReady
	}

	inputJSON, err := json.Marshal(request)
	if err != nil {
		return domain.AccessEvaluationResponse{}, fmt.Errorf("encode AuthZEN evaluation input: %w", err)
	}
	var input map[string]any
	if err := json.Unmarshal(inputJSON, &input); err != nil {
		return domain.AccessEvaluationResponse{}, fmt.Errorf("decode AuthZEN evaluation input: %w", err)
	}

	result, err := a.opa.Decision(ctx, sdk.DecisionOptions{Path: "authz", Input: input})
	if err != nil {
		return domain.AccessEvaluationResponse{}, fmt.Errorf("evaluate OPA decision: %w", err)
	}
	document, ok := result.Result.(map[string]any)
	if !ok {
		return domain.AccessEvaluationResponse{}, fmt.Errorf("decode OPA result: expected object, got %T", result.Result)
	}
	decision, ok := document["allow"].(bool)
	if !ok {
		return domain.AccessEvaluationResponse{}, fmt.Errorf("decode OPA result: expected boolean allow field")
	}
	reasons, err := parseReasons(document["reasons"])
	if err != nil {
		return domain.AccessEvaluationResponse{}, err
	}
	policyVersion := result.Provenance.Bundles["authz"].Revision
	if policyVersion == "" {
		return domain.AccessEvaluationResponse{}, domain.ErrEngineNotReady
	}

	return domain.AccessEvaluationResponse{
		Decision: decision,
		Context: &domain.AccessEvaluationContext{
			Reasons:       reasons,
			PolicyVersion: policyVersion,
		},
	}, nil
}

func parseReasons(value any) ([]string, error) {
	switch reasons := value.(type) {
	case []string:
		return reasons, nil
	case []any:
		parsed := make([]string, 0, len(reasons))
		for _, reason := range reasons {
			text, ok := reason.(string)
			if !ok {
				return nil, fmt.Errorf("decode OPA reasons: expected string, got %T", reason)
			}
			parsed = append(parsed, text)
		}
		return parsed, nil
	default:
		return nil, fmt.Errorf("decode OPA reasons: expected array, got %T", value)
	}
}
