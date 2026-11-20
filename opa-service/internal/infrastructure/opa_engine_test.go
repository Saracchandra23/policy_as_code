package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/open-policy-agent/opa/v1/logging"
	"github.com/open-policy-agent/opa/v1/sdk"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

func TestOPAEngineEvaluatesAuthZenInput(t *testing.T) {
	rego, err := os.ReadFile(filepath.Join("..", "..", "policies", "authz.rego"))
	if err != nil {
		t.Fatalf("read seed Rego policy: %v", err)
	}
	dataBytes, err := os.ReadFile(filepath.Join("..", "..", "policies", "data.json"))
	if err != nil {
		t.Fatalf("read seed policy data: %v", err)
	}
	var data map[string]any
	if err := json.Unmarshal(dataBytes, &data); err != nil {
		t.Fatalf("decode seed policy data: %v", err)
	}
	bundle, err := NewBundleStore(string(rego), data)
	if err != nil {
		t.Fatalf("create seed bundle: %v", err)
	}
	bundleBody, revision, err := bundle.TarGz(context.Background())
	if err != nil {
		t.Fatalf("create seed bundle tarball: %v", err)
	}
	requests := make(chan string, 10)
	bundleServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		select {
		case requests <- req.Method + " " + req.URL.Path:
		default:
		}
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("ETag", `"`+string(revision)+`"`)
		_, _ = w.Write(bundleBody)
	}))
	defer bundleServer.Close()

	config := fmt.Sprintf(`services:
  bundle_server:
    url: %s
bundles:
  authz:
    service: bundle_server
    resource: /bundle-server/bundles/bundle.tar.gz
    polling:
      min_delay_seconds: 1
      max_delay_seconds: 1
`, bundleServer.URL)
	ready := make(chan struct{})
	engine, err := sdk.New(context.Background(), sdk.Options{
		ID:     "authzen-infrastructure-test",
		Logger: logging.NewNoOpLogger(),
		Config: strings.NewReader(config),
		Ready:  ready,
	})
	if err != nil {
		t.Fatalf("initialize OPA: %v", err)
	}
	defer engine.Stop(context.Background())

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		select {
		case request := <-requests:
			t.Fatalf("OPA did not become ready; last bundle request was %s", request)
		default:
			t.Fatal("OPA did not become ready and did not request the configured bundle")
		}
	}

	adapter := NewOPAEngineAdapter(engine, bundle, ready)
	request := domain.AccessEvaluationRequest{
		Subject: domain.Subject{
			Type: "user", ID: "alice",
			Properties: map[string]any{"roles": []any{"viewer"}},
		},
		Resource: domain.Resource{
			Type: "document", ID: "doc-1",
			Properties: map[string]any{"classification": "public"},
		},
		Action:  domain.Action{Name: "read"},
		Context: map[string]any{"authenticated": true},
	}
	allowed, err := adapter.Evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("evaluate allowed AuthZEN request: %v", err)
	}
	if !allowed.Decision || allowed.Context == nil || allowed.Context.PolicyVersion != string(revision) {
		t.Fatalf("unexpected allow result: %#v", allowed)
	}

	deniedRequests := []struct {
		name   string
		mutate func(*domain.AccessEvaluationRequest)
	}{
		{
			name: "unauthenticated context",
			mutate: func(request *domain.AccessEvaluationRequest) {
				request.Context["authenticated"] = false
			},
		},
		{
			name: "unsupported action",
			mutate: func(request *domain.AccessEvaluationRequest) {
				request.Action.Name = "delete"
			},
		},
		{
			name: "restricted resource",
			mutate: func(request *domain.AccessEvaluationRequest) {
				request.Resource.Properties["classification"] = "restricted"
			},
		},
		{
			name: "unsupported subject",
			mutate: func(request *domain.AccessEvaluationRequest) {
				request.Subject.Properties["roles"] = []any{}
			},
		},
	}
	for _, test := range deniedRequests {
		t.Run(test.name, func(t *testing.T) {
			deniedRequest := request
			deniedRequest.Subject.Properties = map[string]any{"roles": []any{"viewer"}}
			deniedRequest.Resource.Properties = map[string]any{"classification": "public"}
			deniedRequest.Context = map[string]any{"authenticated": true}
			test.mutate(&deniedRequest)
			denied, err := adapter.Evaluate(context.Background(), deniedRequest)
			if err != nil {
				t.Fatalf("evaluate denied AuthZEN request: %v", err)
			}
			if denied.Decision {
				t.Fatalf("expected denial, got %#v", denied)
			}
		})
	}

	workspaceRequest := domain.AccessEvaluationRequest{
		Subject: domain.Subject{
			Type: "user", ID: "carol",
			Properties: map[string]any{"roles": []any{"admin"}},
		},
		Resource: domain.Resource{
			Type: "workspace", ID: "workspace-prod",
			Properties: map[string]any{"owner": "carol"},
		},
		Action:  domain.Action{Name: "delete_workspace"},
		Context: map[string]any{"authenticated": true},
	}
	workspaceAllowed, err := adapter.Evaluate(context.Background(), workspaceRequest)
	if err != nil {
		t.Fatalf("evaluate admin workspace deletion: %v", err)
	}
	if !workspaceAllowed.Decision {
		t.Fatalf("expected admin workspace deletion to be allowed, got %#v", workspaceAllowed)
	}

	workspaceRequest.Subject = domain.Subject{
		Type: "user", ID: "alice",
		Properties: map[string]any{"roles": []any{"viewer"}},
	}
	workspaceDenied, err := adapter.Evaluate(context.Background(), workspaceRequest)
	if err != nil {
		t.Fatalf("evaluate viewer workspace deletion: %v", err)
	}
	if workspaceDenied.Decision {
		t.Fatalf("expected viewer workspace deletion to be denied, got %#v", workspaceDenied)
	}
}
