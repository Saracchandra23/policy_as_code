import {
  ApprovePolicyUseCase,
  EnforceAccessUseCase,
  ExplainDenialUseCase,
  GetControlPlaneStateUseCase,
} from "../application/usecases";
import { DurableObjectContainerPDPAdapter } from "../infrastructure/DurableObjectContainerPDPAdapter";
import { HttpAuthZenPDPAdapter } from "../infrastructure/HttpAuthZenPDPAdapter";
import { SqlitePolicyStorageAdapter } from "../infrastructure/SqlitePolicyStorageAdapter";
import { WorkersAILlamaAdapter } from "../infrastructure/WorkersAILlamaAdapter";

export function createContainer(env: Env, ctx: DurableObjectState) {
  const storage = new SqlitePolicyStorageAdapter(ctx.storage.sql);
  const pdp = ctx.container
    ? new DurableObjectContainerPDPAdapter(ctx.container)
    : new HttpAuthZenPDPAdapter(env.OPA_SERVICE_URL);
  const llm = new WorkersAILlamaAdapter(env.AI);
  return {
    storage,
    pdp,
    llm,
    enforceAccess: new EnforceAccessUseCase(pdp, storage),
    approvePolicy: new ApprovePolicyUseCase(storage, pdp),
    explainDenial: new ExplainDenialUseCase(storage, llm),
    getState: new GetControlPlaneStateUseCase(storage),
  };
}

export function createWorkflowContainer(env: Env) {
  return { llm: new WorkersAILlamaAdapter(env.AI) };
}
