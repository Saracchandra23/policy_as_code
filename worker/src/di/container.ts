import {
  ApprovePolicyUseCase,
  EnforceAccessUseCase,
  ExplainDenialUseCase,
  GetControlPlaneStateUseCase,
} from "../application/usecases";
import { HttpAuthZenPDPAdapter } from "../infrastructure/HttpAuthZenPDPAdapter";
import { SqlitePolicyStorageAdapter } from "../infrastructure/SqlitePolicyStorageAdapter";
import { WorkersAILlamaAdapter } from "../infrastructure/WorkersAILlamaAdapter";

export function createContainer(env: Env, sql: SqlStorage) {
  const storage = new SqlitePolicyStorageAdapter(sql);
  const pdp = new HttpAuthZenPDPAdapter(env.OPA_SERVICE_URL);
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

export function createGatewayContainer(env: Env) {
  return { pdp: new HttpAuthZenPDPAdapter(env.OPA_SERVICE_URL) };
}

export function createWorkflowContainer(env: Env) {
  return {
    pdp: new HttpAuthZenPDPAdapter(env.OPA_SERVICE_URL),
    llm: new WorkersAILlamaAdapter(env.AI),
  };
}
