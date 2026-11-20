package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cf_ai_policy_as_code/opa-service/internal/application"
	"cf_ai_policy_as_code/opa-service/internal/domain"
	"cf_ai_policy_as_code/opa-service/internal/infrastructure"
)

const testRego = `package authz

import rego.v1

default allow := false
`

func TestHealthEndpoint(t *testing.T) {
	router := testRouter(t)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, want %d", response.Code, http.StatusOK)
	}
	var result map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if result["status"] != "ok" {
		t.Fatalf("unexpected health response: %#v", result)
	}
}

func TestAuthZenEvaluationResponse(t *testing.T) {
	router := testRouter(t)
	request := httptest.NewRequest(http.MethodPost, "/access/v1/evaluation", strings.NewReader(`{
		"subject":{"type":"user","id":"alice"},
		"resource":{"type":"document","id":"doc-1"},
		"action":{"name":"read"},
		"context":{}
	}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d, body %s", response.Code, response.Body)
	}
	var result domain.AccessEvaluationResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode AuthZEN response: %v", err)
	}
	if !result.Decision || result.Context == nil || result.Context.PolicyVersion != "revision-1" {
		t.Fatalf("unexpected AuthZEN response: %#v", result)
	}
}

func TestAuthZenEvaluationRejectsMalformedRequest(t *testing.T) {
	router := testRouter(t)
	request := httptest.NewRequest(http.MethodPost, "/access/v1/evaluation", strings.NewReader(`{
		"subject":{"type":"user","id":"alice"},
		"resource":{"type":"document","id":"doc-1"},
		"action":{"name":"read"}
	}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestAuthZenEvaluationReturnsDenyAndEngineErrors(t *testing.T) {
	bundle, err := infrastructure.NewBundleStore(testRego, map[string]any{})
	if err != nil {
		t.Fatalf("create bundle: %v", err)
	}
	denied := domain.AccessEvaluationResponse{
		Decision: false,
		Context:  &domain.AccessEvaluationContext{Reasons: []string{"denied"}, PolicyVersion: "revision-1"},
	}
	decision := &testDecisionPort{bundle: bundle, response: &denied}
	router := NewRouter(
		application.NewSyncPolicyUseCase(bundle),
		application.NewValidatePolicyUseCase(decision),
		application.NewEvaluatePolicyUseCase(decision),
		application.NewGetPDPConfigurationUseCase(domain.AuthZenConfiguration{}),
		application.NewGetBundleUseCase(bundle),
	).Handler()
	body := `{"subject":{"type":"user","id":"alice"},"resource":{"type":"document","id":"doc-1"},"action":{"name":"read"},"context":{}}`

	request := httptest.NewRequest(http.MethodPost, "/access/v1/evaluation", strings.NewReader(body))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"decision":false`) {
		t.Fatalf("unexpected deny response: %d %s", response.Code, response.Body)
	}

	decision.err = domain.ErrEngineNotReady
	request = httptest.NewRequest(http.MethodPost, "/access/v1/evaluation", strings.NewReader(body))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("got engine error status %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestAuthZenConfiguration(t *testing.T) {
	router := testRouter(t)
	request := httptest.NewRequest(http.MethodGet, "/.well-known/authzen-configuration", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("got status %d", response.Code)
	}
	var configuration PDPConfigurationDTO
	if err := json.Unmarshal(response.Body.Bytes(), &configuration); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if configuration.AccessEvaluationEndpoint != "https://pdp.example/access/v1/evaluation" {
		t.Fatalf("unexpected metadata: %#v", configuration)
	}
}

func TestValidateAndSyncRoutes(t *testing.T) {
	router := testRouter(t)
	regoJSON, err := json.Marshal(testRego)
	if err != nil {
		t.Fatalf("encode test Rego: %v", err)
	}
	validateRequest := httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader(
		`{"rego":`+string(regoJSON)+`}`,
	))
	validateResponse := httptest.NewRecorder()
	router.ServeHTTP(validateResponse, validateRequest)
	if validateResponse.Code != http.StatusOK || !strings.Contains(validateResponse.Body.String(), `"valid":true`) {
		t.Fatalf("unexpected validation response: %d %s", validateResponse.Code, validateResponse.Body)
	}

	syncRequest := httptest.NewRequest(http.MethodPost, "/policies/sync", strings.NewReader(
		`{"rego":`+string(regoJSON)+`,"data":{"roles":{}}}`,
	))
	syncResponse := httptest.NewRecorder()
	router.ServeHTTP(syncResponse, syncRequest)
	if syncResponse.Code != http.StatusOK || !strings.Contains(syncResponse.Body.String(), `"synced":true`) {
		t.Fatalf("unexpected policy sync response: %d %s", syncResponse.Code, syncResponse.Body)
	}
}

func TestBundleResponseIncludesETagAndSupportsConditionalRequest(t *testing.T) {
	router := testRouter(t)
	request := httptest.NewRequest(http.MethodGet, "/bundle-server/bundles/bundle.tar.gz", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("got status %d", response.Code)
	}
	if response.Header().Get("ETag") == "" {
		t.Fatal("expected ETag header")
	}
	if response.Header().Get("Content-Type") != "application/gzip" {
		t.Fatalf("unexpected content type %q", response.Header().Get("Content-Type"))
	}

	conditionalRequest := httptest.NewRequest(http.MethodGet, "/bundle-server/bundles/bundle.tar.gz", nil)
	conditionalRequest.Header.Set("If-None-Match", response.Header().Get("ETag"))
	conditionalResponse := httptest.NewRecorder()
	router.ServeHTTP(conditionalResponse, conditionalRequest)
	if conditionalResponse.Code != http.StatusNotModified {
		t.Fatalf("got conditional status %d", conditionalResponse.Code)
	}
}

func testRouter(t *testing.T) http.Handler {
	t.Helper()
	bundle, err := infrastructure.NewBundleStore(testRego, map[string]any{})
	if err != nil {
		t.Fatalf("create bundle: %v", err)
	}
	decision := &testDecisionPort{bundle: bundle}
	return NewRouter(
		application.NewSyncPolicyUseCase(bundle),
		application.NewValidatePolicyUseCase(decision),
		application.NewEvaluatePolicyUseCase(decision),
		application.NewGetPDPConfigurationUseCase(domain.AuthZenConfiguration{
			PolicyDecisionPoint:      "https://pdp.example",
			AccessEvaluationEndpoint: "https://pdp.example/access/v1/evaluation",
		}),
		application.NewGetBundleUseCase(bundle),
	).Handler()
}

type testDecisionPort struct {
	bundle   *infrastructure.BundleStore
	response *domain.AccessEvaluationResponse
	err      error
}

func (port *testDecisionPort) Evaluate(context.Context, domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error) {
	if port.err != nil {
		return domain.AccessEvaluationResponse{}, port.err
	}
	if port.response != nil {
		return *port.response, nil
	}
	return domain.AccessEvaluationResponse{
		Decision: true,
		Context: &domain.AccessEvaluationContext{
			Reasons: []string{"allowed"}, PolicyVersion: "revision-1",
		},
	}, nil
}

func (port *testDecisionPort) Validate(ctx context.Context, rego string) error {
	return port.bundle.Validate(ctx, rego)
}
