package application

import (
	"context"
	"testing"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

type fakeDecisionPort struct {
	validateErr error
	result      domain.AccessEvaluationResponse
}

func (f *fakeDecisionPort) Validate(context.Context, string) error {
	return f.validateErr
}

func (f *fakeDecisionPort) Evaluate(context.Context, domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error) {
	return f.result, nil
}

type fakeBundlePort struct {
	revision domain.Revision
	err      error
	snapshot domain.BundleSnapshot
}

func (f *fakeBundlePort) Sync(context.Context, domain.PolicyDocument) (domain.Revision, error) {
	return f.revision, f.err
}

func (f *fakeBundlePort) Snapshot(context.Context) (domain.BundleSnapshot, error) {
	return f.snapshot, f.err
}

func (f *fakeBundlePort) TarGz(context.Context) ([]byte, domain.Revision, error) {
	return []byte("bundle"), f.revision, f.err
}

func TestSyncPolicyUseCase(t *testing.T) {
	useCase := NewSyncPolicyUseCase(&fakeBundlePort{revision: "rev-1"})
	revision, err := useCase.Execute(context.Background(), domain.PolicyDocument{Rego: "package authz\nimport rego.v1"})
	if err != nil {
		t.Fatalf("execute sync: %v", err)
	}
	if revision != "rev-1" {
		t.Fatalf("got revision %q", revision)
	}
}

func TestValidatePolicyUseCase(t *testing.T) {
	useCase := NewValidatePolicyUseCase(&fakeDecisionPort{})
	if err := useCase.Execute(context.Background(), "package authz\nimport rego.v1"); err != nil {
		t.Fatalf("execute validate: %v", err)
	}
}

func TestEvaluatePolicyUseCase(t *testing.T) {
	useCase := NewEvaluatePolicyUseCase(&fakeDecisionPort{
		result: domain.AccessEvaluationResponse{Decision: true, Context: &domain.AccessEvaluationContext{
			Reasons: []string{"allowed"}, PolicyVersion: "rev-1",
		}},
	})
	result, err := useCase.Execute(context.Background(), domain.AccessEvaluationRequest{
		Subject: domain.Subject{Type: "user", ID: "alice"},
		Action:  domain.Action{Name: "read"},
	})
	if err != nil {
		t.Fatalf("execute evaluate: %v", err)
	}
	if !result.Decision || result.Context.PolicyVersion != "rev-1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestGetPDPConfigurationUseCase(t *testing.T) {
	expected := domain.AuthZenConfiguration{
		PolicyDecisionPoint:      "https://pdp.example",
		AccessEvaluationEndpoint: "https://pdp.example/access/v1/evaluation",
	}
	actual := NewGetPDPConfigurationUseCase(expected).Execute(context.Background())
	if actual != expected {
		t.Fatalf("got configuration %#v, want %#v", actual, expected)
	}
}
