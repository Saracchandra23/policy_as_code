package domain

import (
	"errors"
	"testing"
)

func TestSentinelErrors(t *testing.T) {
	if !errors.Is(ErrInvalidRego, ErrInvalidRego) {
		t.Fatal("ErrInvalidRego must be detectable")
	}
	if !errors.Is(ErrEngineNotReady, ErrEngineNotReady) {
		t.Fatal("ErrEngineNotReady must be detectable")
	}
}

func TestAuthZenEvaluationValues(t *testing.T) {
	request := AccessEvaluationRequest{
		Subject:  Subject{Type: "user", ID: "alice"},
		Resource: Resource{Type: "document", ID: "doc-1"},
		Action:   Action{Name: "read"},
		Context:  map[string]any{"authenticated": true},
	}
	result := AccessEvaluationResponse{
		Decision: true,
		Context:  &AccessEvaluationContext{Reasons: []string{"allowed"}, PolicyVersion: "rev-1"},
	}
	if request.Subject.ID != "alice" || request.Action.Name != "read" {
		t.Fatalf("unexpected AuthZEN request: %#v", request)
	}
	if !result.Decision || result.Context.PolicyVersion != "rev-1" {
		t.Fatalf("unexpected AuthZEN response: %#v", result)
	}
}
