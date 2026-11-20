package domain

type Subject struct {
	Type       string         `json:"type"`
	ID         string         `json:"id"`
	Properties map[string]any `json:"properties,omitempty"`
}

type Resource struct {
	Type       string         `json:"type"`
	ID         string         `json:"id"`
	Properties map[string]any `json:"properties,omitempty"`
}

type Action struct {
	Name       string         `json:"name"`
	Properties map[string]any `json:"properties,omitempty"`
}

type AccessEvaluationRequest struct {
	Subject  Subject        `json:"subject"`
	Resource Resource       `json:"resource"`
	Action   Action         `json:"action"`
	Context  map[string]any `json:"context"`
}

type AccessEvaluationContext struct {
	Reasons       []string `json:"reasons"`
	PolicyVersion string   `json:"policy_version,omitempty"`
}

type AccessEvaluationResponse struct {
	Decision bool                     `json:"decision"`
	Context  *AccessEvaluationContext `json:"context,omitempty"`
}

type AuthZenConfiguration struct {
	PolicyDecisionPoint      string `json:"policy_decision_point"`
	AccessEvaluationEndpoint string `json:"access_evaluation_endpoint"`
}
