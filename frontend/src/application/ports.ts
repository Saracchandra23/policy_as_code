import type {
  AccessEvaluationRequest,
  AuthZenConfiguration,
} from "../domain/authzen";
import type {
  ChatCommand,
  ChatResult,
  ControlPlaneState,
  EnforcementResult,
  PolicyVersion,
  WorkflowStatus,
} from "../domain/policy";

export interface PolicyApiPort {
  enforceAccess(request: AccessEvaluationRequest): Promise<EnforcementResult>;
  approvePolicy(candidateId: string): Promise<PolicyVersion>;
  getConfiguration(): Promise<AuthZenConfiguration>;
}

export interface AuditStreamPort {
  getState(): Promise<ControlPlaneState>;
}

export interface CopilotPort {
  postChat(command: ChatCommand): Promise<ChatResult>;
  getWorkflowStatus(workflowId: string, workspaceId?: string): Promise<WorkflowStatus>;
}

export interface ControlPlaneApiPort extends PolicyApiPort, AuditStreamPort, CopilotPort {}
