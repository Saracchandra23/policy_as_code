package di

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/open-policy-agent/opa/v1/sdk"

	"cf_ai_policy_as_code/opa-service/internal/application"
	delivery "cf_ai_policy_as_code/opa-service/internal/delivery/http"
	"cf_ai_policy_as_code/opa-service/internal/domain"
	"cf_ai_policy_as_code/opa-service/internal/infrastructure"
)

type Container struct {
	Handler http.Handler
	opa     *sdk.OPA
}

func NewContainer(ctx context.Context, configPath string) (*Container, error) {
	config, err := infrastructure.LoadOPAConfig(ctx, configPath)
	if err != nil {
		return nil, fmt.Errorf("construct OPA container: %w", err)
	}
	rego, err := os.ReadFile("./policies/authz.rego")
	if err != nil {
		return nil, fmt.Errorf("read seed Rego policy: %w", err)
	}
	dataBytes, err := os.ReadFile("./policies/data.json")
	if err != nil {
		return nil, fmt.Errorf("read seed policy data: %w", err)
	}
	var data map[string]any
	if err := json.Unmarshal(dataBytes, &data); err != nil {
		return nil, fmt.Errorf("decode seed policy data: %w", err)
	}

	bundle, err := infrastructure.NewBundleStore(string(rego), data)
	if err != nil {
		return nil, fmt.Errorf("construct policy bundle repository: %w", err)
	}
	ready := make(chan struct{})
	engine, err := sdk.New(ctx, sdk.Options{
		ID:     "cf-ai-policy-as-code",
		Config: bytes.NewReader(config),
		Ready:  ready,
	})
	if err != nil {
		return nil, fmt.Errorf("construct embedded OPA engine: %w", err)
	}

	publicURL, err := configuredPublicURL()
	if err != nil {
		engine.Stop(context.Background())
		return nil, fmt.Errorf("configure PDP discovery metadata: %w", err)
	}
	configuration := domain.AuthZenConfiguration{
		PolicyDecisionPoint:      publicURL,
		AccessEvaluationEndpoint: publicURL + "/access/v1/evaluation",
	}

	decision := infrastructure.NewOPAEngineAdapter(engine, bundle, ready)
	syncUseCase := application.NewSyncPolicyUseCase(bundle)
	validateUseCase := application.NewValidatePolicyUseCase(decision)
	evaluateUseCase := application.NewEvaluatePolicyUseCase(decision)
	configurationUseCase := application.NewGetPDPConfigurationUseCase(configuration)
	bundleUseCase := application.NewGetBundleUseCase(bundle)
	router := delivery.NewRouter(
		syncUseCase,
		validateUseCase,
		evaluateUseCase,
		configurationUseCase,
		bundleUseCase,
	)
	return &Container{Handler: router.Handler(), opa: engine}, nil
}

func (c *Container) Close(ctx context.Context) {
	c.opa.Stop(ctx)
}

func configuredPublicURL() (string, error) {
	publicURL := strings.TrimRight(os.Getenv("PDP_PUBLIC_URL"), "/")
	if publicURL == "" {
		publicURL = "http://localhost:8080"
	}
	parsed, err := url.ParseRequestURI(publicURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("PDP_PUBLIC_URL must be an absolute URL")
	}
	return publicURL, nil
}
