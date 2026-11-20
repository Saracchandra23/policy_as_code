export interface AuthZenSubject {
  type: string;
  id: string;
  properties?: Record<string, unknown>;
}

export interface AuthZenResource {
  type: string;
  id: string;
  properties?: Record<string, unknown>;
}

export interface AuthZenAction {
  name: string;
  properties?: Record<string, unknown>;
}

export interface AccessEvaluationRequest {
  subject: AuthZenSubject;
  resource: AuthZenResource;
  action: AuthZenAction;
  context?: Record<string, unknown>;
}

export interface AccessEvaluationResponse {
  decision: boolean;
  context?: {
    reasons?: string[];
    policy_version?: string;
  };
}

export interface AuthZenConfiguration {
  policy_decision_point: string;
  access_evaluation_endpoint: string;
}
