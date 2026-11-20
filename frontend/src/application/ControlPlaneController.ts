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
import type {
  AuditStreamPort,
  CopilotPort,
  PolicyApiPort,
} from "./ports";

export class ControlPlaneController {
  constructor(
    private readonly policyApi: PolicyApiPort,
    private readonly auditStream: AuditStreamPort,
    private readonly copilot: CopilotPort,
  ) {}

  getState(): Promise<ControlPlaneState> {
    return this.auditStream.getState();
  }

  enforceAccess(request: AccessEvaluationRequest): Promise<EnforcementResult> {
    return this.policyApi.enforceAccess(request);
  }

  postChat(command: ChatCommand): Promise<ChatResult> {
    return this.copilot.postChat(command);
  }

  getWorkflowStatus(workflowId: string, workspaceId?: string): Promise<WorkflowStatus> {
    return this.copilot.getWorkflowStatus(workflowId, workspaceId);
  }

  approvePolicy(candidateId: string): Promise<PolicyVersion> {
    return this.policyApi.approvePolicy(candidateId);
  }

  getConfiguration(): Promise<AuthZenConfiguration> {
    return this.policyApi.getConfiguration();
  }
}
