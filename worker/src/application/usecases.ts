import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
} from "../domain/authzen";
import type {
  AuditLogEntry,
  CandidatePolicy,
  ChatMessage,
  ControlPlaneState,
  PolicyVersion,
} from "../domain/policy";
import type {
  AuthZenPDPPort,
  CopilotLLMPort,
  PolicyStoragePort,
} from "./ports";

export class EnforceAccessUseCase {
  constructor(
    private readonly pdp: AuthZenPDPPort,
    private readonly storage: PolicyStoragePort,
  ) {}

  async execute(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    const response = await this.pdp.evaluate(request);
    const entry: AuditLogEntry = {
      eventType: "authorization",
      occurredAt: new Date().toISOString(),
      request,
      response,
    };
    await this.storage.appendAuditLog(entry);
    return response;
  }
}

export class ApprovePolicyUseCase {
  constructor(
    private readonly storage: PolicyStoragePort,
    private readonly pdp: AuthZenPDPPort,
  ) {}

  async execute(candidateId: string): Promise<PolicyVersion> {
    const candidate = await this.storage.getLatestCandidate();
    if (!candidate || candidate.id !== candidateId) {
      throw new Error(`candidate policy not found: ${candidateId}`);
    }

    const validation = await this.pdp.validateRego(candidate.regoCode);
    if (!validation.valid) {
      throw new Error(`candidate policy failed OPA validation: ${validation.errors.join("; ")}`);
    }

    const activated = await this.storage.approveCandidate(candidateId);
    await this.pdp.syncPolicy(activated.regoCode, activated.version);
    await this.storage.appendAuditLog({
      eventType: "policy_activated",
      occurredAt: activated.activatedAt,
      details: {
        policyId: activated.id,
        policyVersion: activated.version,
      },
    });
    return activated;
  }
}

export class ExplainDenialUseCase {
  constructor(
    private readonly storage: PolicyStoragePort,
    private readonly llm: CopilotLLMPort,
  ) {}

  async execute(
    request: AccessEvaluationRequest,
    response: AccessEvaluationResponse,
    workflowId?: string,
  ): Promise<string> {
    if (response.decision) {
      throw new Error("cannot explain an allowed authorization decision as a denial");
    }
    const activePolicy = await this.storage.getActivePolicy();
    if (!activePolicy) {
      throw new Error("cannot explain denial without an active policy");
    }
    const explanation = await this.llm.explainDenial(request, response, activePolicy.regoCode);
    const message: ChatMessage = {
      role: "assistant",
      content: explanation,
      workflowId,
      createdAt: new Date().toISOString(),
    };
    await this.storage.appendChatMessage(message);
    return explanation;
  }
}

export class GetControlPlaneStateUseCase {
  constructor(private readonly storage: PolicyStoragePort) {}

  async execute(): Promise<ControlPlaneState> {
    const [activePolicy, candidatePolicy, policyVersions, auditLogs, chatMessages] =
      await Promise.all([
        this.storage.getActivePolicy(),
        this.storage.getLatestCandidate(),
        this.storage.listPolicyVersions(),
        this.storage.listAuditLogs(100),
        this.storage.listChatMessages(100),
      ]);
    return { activePolicy, candidatePolicy, policyVersions, auditLogs, chatMessages };
  }
}

export function createCandidatePolicy(
  id: string,
  version: string,
  regoCode: string,
  originalPrompt: string,
  explanation: string,
): CandidatePolicy {
  return {
    id,
    version,
    regoCode,
    originalPrompt,
    explanation,
    createdAt: new Date().toISOString(),
  };
}
