import { DurableObject } from "cloudflare:workers";
import type { AccessEvaluationRequest, AccessEvaluationResponse } from "../domain/authzen";
import type {
  CandidatePolicy,
  ChatMessage,
  ControlPlaneState,
  WorkflowProgress,
} from "../domain/policy";
import { createContainer } from "../di/container";
import { DEFAULT_AUTHZ_POLICY } from "../infrastructure/default_policy";

type PolicyContainer = ReturnType<typeof createContainer>;

export class PolicyEngineDO extends DurableObject<Env> {
  private readonly initialized: Promise<void>;
  private container!: PolicyContainer;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initialized = this.ctx.blockConcurrencyWhile(async () => {
      this.container = createContainer(this.env, this.ctx);
      await this.container.storage.initSchema();
      await this.container.storage.seedDefaultPolicyIfEmpty(DEFAULT_AUTHZ_POLICY);
    });
  }

  async evaluatePdp(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    await this.initialized;
    return this.container.pdp.evaluate(request);
  }

  async evaluatePep(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    await this.initialized;
    return this.container.enforceAccess.execute(request);
  }

  async getPdpConfiguration() {
    await this.initialized;
    return this.container.pdp.getConfiguration();
  }

  async validatePolicy(regoCode: string) {
    await this.initialized;
    return this.container.pdp.validateRego(regoCode);
  }

  async getState(): Promise<ControlPlaneState> {
    await this.initialized;
    return this.container.getState.execute();
  }

  async getActivePolicyRego(): Promise<string> {
    await this.initialized;
    const activePolicy = await this.container.storage.getActivePolicy();
    return activePolicy?.regoCode ?? "";
  }

  async recordWorkflowProgress(
    workflowId: string,
    step: WorkflowProgress["step"],
  ): Promise<void> {
    await this.initialized;
    await this.container.storage.setWorkflowProgress(workflowId, step);
  }

  async getWorkflowProgress(workflowId: string): Promise<WorkflowProgress | null> {
    await this.initialized;
    return this.container.storage.getWorkflowProgress(workflowId);
  }

  async saveCandidate(candidate: CandidatePolicy): Promise<void> {
    await this.initialized;
    await this.container.storage.saveCandidatePolicy(candidate);
  }

  async approveCandidate(candidateId: string) {
    await this.initialized;
    return this.container.approvePolicy.execute(candidateId);
  }

  async recordChat(message: ChatMessage): Promise<void> {
    await this.initialized;
    await this.container.storage.appendChatMessage(message);
  }

  async explainDenial(
    request: AccessEvaluationRequest,
    response: AccessEvaluationResponse,
    workflowId?: string,
  ): Promise<string> {
    await this.initialized;
    return this.container.explainDenial.execute(request, response, workflowId);
  }
}
