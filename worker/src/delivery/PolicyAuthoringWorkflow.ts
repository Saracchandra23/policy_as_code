import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { createCandidatePolicy } from "../application/usecases";
import type { CandidatePolicy } from "../domain/policy";
import { createWorkflowContainer } from "../di/container";

export interface PolicyAuthoringParams {
  prompt: string;
  workspaceId: string;
  workflowId: string;
}

export class PolicyAuthoringWorkflow extends WorkflowEntrypoint<Env, PolicyAuthoringParams> {
  private readonly services: ReturnType<typeof createWorkflowContainer>;

  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    this.services = createWorkflowContainer(env);
  }

  async run(event: WorkflowEvent<PolicyAuthoringParams>, step: WorkflowStep): Promise<CandidatePolicy> {
    const { workspaceId, prompt, workflowId } = event.payload;
    const policyStub = this.env.POLICY_DO.get(
      this.env.POLICY_DO.idFromName(workspaceId),
    );

    const currentRego = await step.do("fetch-current-policy", async () => {
      return policyStub.getActivePolicyRego();
    });

    const generated = await step.do("generate-rego-v1", async () => {
      await policyStub.recordWorkflowProgress(workflowId, "generate-rego-v1");
      return this.services.llm.generateRegoV1(prompt, currentRego);
    });

    const initialValidation = await step.do("validate-with-opa", async () => {
      await policyStub.recordWorkflowProgress(workflowId, "validate-with-opa");
      return this.services.pdp.validateRego(generated.regoCode);
    });

    const repaired = await step.do("auto-repair-if-invalid", async () => {
      if (initialValidation.valid) {
        await policyStub.recordWorkflowProgress(workflowId, "persist-candidate");
        return { ...generated, validation: initialValidation };
      }
      await policyStub.recordWorkflowProgress(workflowId, "auto-repair-if-invalid");
      const repair = await this.services.llm.repairRegoV1(
        generated.regoCode,
        initialValidation.errors,
        prompt,
      );
      const validation = await this.services.pdp.validateRego(repair.regoCode);
      return { ...repair, validation };
    });

    if (!repaired.validation.valid) {
      throw new Error(
        `policy remains invalid after automatic repair: ${repaired.validation.errors.join("; ")}`,
      );
    }

    return step.do("persist-candidate", async () => {
      await policyStub.recordWorkflowProgress(workflowId, "persist-candidate");
      const id = crypto.randomUUID();
      const version = `candidate-${id}`;
      const candidate = createCandidatePolicy(
        id,
        version,
        repaired.regoCode,
        prompt,
        repaired.explanation,
      );
      await policyStub.saveCandidate(candidate);
      await policyStub.recordChat({
        role: "assistant",
        content: repaired.explanation,
        createdAt: new Date().toISOString(),
      });
      await policyStub.recordWorkflowProgress(workflowId, "ready");
      return candidate;
    });
  }
}
