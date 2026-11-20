import type { AccessEvaluationRequest, AccessEvaluationResponse } from "../domain/authzen";
import type { ChatMessage } from "../domain/policy";

interface ApproveRequest {
  candidateId: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  try {
    return withCors(await routeRequest(request, env));
  } catch (error) {
    console.error("Worker request failed", error);
    const status = error instanceof RequestError ? error.status : 500;
    return withCors(jsonResponse({ error: errorMessage(error) }, status));
  }
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/.well-known/authzen-configuration") {
    return jsonResponse(
      await policyEngineStub(env, "default").getPdpConfiguration(),
    );
  }
  if (request.method === "POST" && pathname === "/access/v1/evaluation") {
    const body = await readJson<unknown>(request);
    assertAccessRequest(body);
    return jsonResponse(await policyEngineStub(env, "default").evaluatePdp(body));
  }
  if (request.method === "POST" && pathname === "/api/pep/enforce") {
    const body = await readJson<unknown>(request);
    assertAccessRequest(body);
    const result = await policyEngineStub(env, "default").evaluatePep(body);
    return jsonResponse(result, result.decision ? 200 : 403);
  }
  if (request.method === "GET" && pathname === "/api/state") {
    return jsonResponse(await policyEngineStub(env, "default").getState());
  }
  if (request.method === "POST" && pathname === "/api/chat") {
    return handleChat(request, env);
  }
  if (request.method === "POST" && pathname === "/api/policies/approve") {
    const body = await readJson<ApproveRequest>(request);
    if (typeof body.candidateId !== "string" || body.candidateId.length === 0) {
      return jsonResponse({ error: "candidateId is required" }, 400);
    }
    return jsonResponse(
      await policyEngineStub(env, "default").approveCandidate(body.candidateId),
    );
  }
  const workflowMatch = /^\/api\/workflows\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && workflowMatch) {
    const workflowId = decodeURIComponent(workflowMatch[1]);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || "default";
    const workflow = await env.POLICY_WORKFLOW.get(workflowId);
    const [status, progress] = await Promise.all([
      workflow.status(),
      policyEngineStub(env, workspaceId).getWorkflowProgress(workflowId),
    ]);
    return jsonResponse({ ...status, progress });
  }
  return jsonResponse({ error: "not_found" }, 404);
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await readJson<unknown>(request);
  if (!isRecord(body)) {
    throw new RequestError("request body must be a JSON object");
  }
  if (
    typeof body.message !== "string" ||
    body.message.trim().length === 0
  ) {
    throw new RequestError("message is required");
  }
  const mode = body.mode;
  if (mode !== undefined && mode !== "explain_denial" && mode !== "author_policy") {
    throw new RequestError("invalid chat mode");
  }
  if (body.workspaceId !== undefined && typeof body.workspaceId !== "string") {
    throw new RequestError("workspaceId must be a string");
  }
  const message = body.message;
  const workspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId.trim() || "default" : "default";
  const stub = policyEngineStub(env, workspaceId);
  if (mode === "explain_denial") {
    const evaluationRequest = body.request;
    const evaluationResponse = body.response;
    assertAccessRequest(evaluationRequest);
    assertAccessResponse(evaluationResponse);
    if (evaluationResponse.decision) {
      throw new RequestError("a denied AuthZEN request and response are required");
    }
    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    await stub.recordChat(userMessage);
    const explanation = await stub.explainDenial(evaluationRequest, evaluationResponse);
    return jsonResponse({ explanation });
  }

  const workflowId = crypto.randomUUID();
  const userMessage: ChatMessage = {
    role: "user",
    content: message,
    workflowId,
    createdAt: new Date().toISOString(),
  };
  await stub.recordChat(userMessage);
  const workflow = await env.POLICY_WORKFLOW.create({
    id: workflowId,
    params: { prompt: message, workspaceId, workflowId },
  });
  return jsonResponse({ workflowId: workflow.id }, 202);
}

function policyEngineStub(env: Env, workspaceId: string) {
  const id = env.POLICY_DO.idFromName(workspaceId);
  return env.POLICY_DO.get(id);
}

async function readJson<T>(request: Request): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    throw new RequestError(`invalid JSON request: ${errorMessage(error)}`);
  }
  if (!isRecord(value)) {
    throw new RequestError("request body must be a JSON object");
  }
  return value as T;
}

function assertAccessRequest(value: unknown): asserts value is AccessEvaluationRequest {
  if (
    !isRecord(value) ||
    !isRecord(value.subject) ||
    typeof value.subject.type !== "string" ||
    typeof value.subject.id !== "string" ||
    (value.subject.properties !== undefined && !isRecord(value.subject.properties)) ||
    !isRecord(value.resource) ||
    typeof value.resource.type !== "string" ||
    typeof value.resource.id !== "string" ||
    (value.resource.properties !== undefined && !isRecord(value.resource.properties)) ||
    !isRecord(value.action) ||
    typeof value.action.name !== "string" ||
    (value.action.properties !== undefined && !isRecord(value.action.properties)) ||
    (value.context !== undefined && !isRecord(value.context))
  ) {
    throw new RequestError("invalid AuthZEN AccessEvaluationRequest");
  }
}

function assertAccessResponse(value: unknown): asserts value is AccessEvaluationResponse {
  if (!isRecord(value) || typeof value.decision !== "boolean") {
    throw new RequestError("invalid AuthZEN AccessEvaluationResponse");
  }
  if (value.context !== undefined) {
    if (!isRecord(value.context)) {
      throw new RequestError("invalid AuthZEN AccessEvaluationResponse context");
    }
    if (
      (value.context.reasons !== undefined &&
        (!Array.isArray(value.context.reasons) ||
          !value.context.reasons.every((reason) => typeof reason === "string"))) ||
      (value.context.policy_version !== undefined &&
        typeof value.context.policy_version !== "string")
    ) {
      throw new RequestError("invalid AuthZEN AccessEvaluationResponse context");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RequestError extends Error {
  readonly status = 400;
}
