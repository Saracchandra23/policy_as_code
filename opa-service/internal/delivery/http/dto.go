package http

import "cf_ai_policy_as_code/opa-service/internal/domain"

type SyncRequest struct {
	Rego string         `json:"rego"`
	Data map[string]any `json:"data"`
}

type SyncResponse struct {
	Revision string `json:"revision"`
	Synced   bool   `json:"synced"`
}

type ValidateRequest struct {
	Rego string `json:"rego"`
}

type ValidateResponse struct {
	Valid   bool   `json:"valid"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

type AccessEvaluationRequestDTO struct {
	Subject  domain.Subject  `json:"subject"`
	Resource domain.Resource `json:"resource"`
	Action   domain.Action   `json:"action"`
	Context  map[string]any  `json:"context"`
}

func (dto AccessEvaluationRequestDTO) Domain() domain.AccessEvaluationRequest {
	return domain.AccessEvaluationRequest{
		Subject:  dto.Subject,
		Resource: dto.Resource,
		Action:   dto.Action,
		Context:  dto.Context,
	}
}

type PDPConfigurationDTO struct {
	PolicyDecisionPoint      string `json:"policy_decision_point"`
	AccessEvaluationEndpoint string `json:"access_evaluation_endpoint"`
}

func (dto PDPConfigurationDTO) Domain() domain.AuthZenConfiguration {
	return domain.AuthZenConfiguration{
		PolicyDecisionPoint:      dto.PolicyDecisionPoint,
		AccessEvaluationEndpoint: dto.AccessEvaluationEndpoint,
	}
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}
