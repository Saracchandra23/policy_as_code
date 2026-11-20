import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
  AuthZenConfiguration,
} from "../domain/authzen";
import type {
  AuditLogEntry,
  CandidatePolicy,
  ChatMessage,
  PolicyVersion,
  ValidationResult,
  WorkflowProgress,
} from "../domain/policy";

export interface PolicyStoragePort {
  initSchema(): Promise<void>;
  seedDefaultPolicyIfEmpty(rego: string): Promise<void>;
  getActivePolicy(): Promise<PolicyVersion | null>;
  listPolicyVersions(): Promise<PolicyVersion[]>;
  saveCandidatePolicy(candidate: CandidatePolicy): Promise<void>;
  getLatestCandidate(): Promise<CandidatePolicy | null>;
  approveCandidate(candidateId: string): Promise<PolicyVersion>;
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogEntry[]>;
  appendChatMessage(message: ChatMessage): Promise<void>;
  listChatMessages(limit: number): Promise<ChatMessage[]>;
  setWorkflowProgress(workflowId: string, step: WorkflowProgress["step"]): Promise<void>;
  getWorkflowProgress(workflowId: string): Promise<WorkflowProgress | null>;
}

export interface AuthZenPDPPort {
  evaluate(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse>;
  validateRego(regoCode: string): Promise<ValidationResult>;
  syncPolicy(regoCode: string, version: string): Promise<void>;
  getConfiguration(): Promise<AuthZenConfiguration>;
}

export interface CopilotLLMPort {
  generateRegoV1(
    prompt: string,
    currentRego: string,
  ): Promise<{ regoCode: string; explanation: string }>;
  repairRegoV1(
    brokenRego: string,
    compilerErrors: string[],
    originalPrompt: string,
  ): Promise<{ regoCode: string; explanation: string }>;
  explainDenial(
    request: AccessEvaluationRequest,
    response: AccessEvaluationResponse,
    activeRego: string,
  ): Promise<string>;
}
