import { handleRequest } from "./worker_router";

export { PolicyEngineDO } from "./PolicyEngineDO";
export { PolicyAuthoringWorkflow } from "./PolicyAuthoringWorkflow";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
