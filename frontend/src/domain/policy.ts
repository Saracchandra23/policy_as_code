import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
} from "./authzen";

export interface PolicyVersion {
  id: string;
  version: string;
  regoCode: string;
  createdAt: string;
  activatedAt: string;
}

export interface CandidatePolicy {
  id: string;
  version: string;
  regoCode: string;
  originalPrompt: string;
  explanation: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id?: number;
  eventType: string;
  occurredAt: string;
  request?: AccessEvaluationRequest;
  response?: AccessEvaluationResponse;
  details?: Record<string, unknown>;
}

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  workflowId?: string;
  createdAt: string;
}

export interface ControlPlaneState {
  activePolicy: PolicyVersion | null;
  candidatePolicy: CandidatePolicy | null;
  policyVersions: PolicyVersion[];
  auditLogs: AuditLogEntry[];
  chatMessages: ChatMessage[];
}

export interface WorkflowProgress {
  workflowId: string;
  step:
    | "generate-rego-v1"
    | "validate-with-opa"
    | "auto-repair-if-invalid"
    | "persist-candidate"
    | "ready";
  updatedAt: string;
}

export interface WorkflowStatus {
  status:
    | "queued"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "rollingBack"
    | "unknown";
  error?: {
    name: string;
    message: string;
  };
  output?: unknown;
  progress?: WorkflowProgress | null;
}

export interface EnforcementResult {
  httpStatus: 200 | 403;
  response: AccessEvaluationResponse;
}

export type ChatCommand =
  | {
      message: string;
      mode?: "author_policy";
      workspaceId?: string;
    }
  | {
      message: string;
      mode: "explain_denial";
      request: AccessEvaluationRequest;
      response: AccessEvaluationResponse;
      workspaceId?: string;
    };

export type ChatResult =
  | { workflowId: string }
  | { explanation: string };
