import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
  AuthZenConfiguration,
} from "../domain/authzen";
import type {
  AuditLogEntry,
  CandidatePolicy,
  ChatMessage,
  ControlPlaneState,
  PolicyVersion,
  WorkflowProgress,
  WorkflowStatus,
} from "../domain/policy";
import type { ControlPlaneApiPort } from "../application/ports";

export type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
  AuthZenAction,
  AuthZenConfiguration,
  AuthZenResource,
  AuthZenSubject,
} from "../domain/authzen";
export type {
  AuditLogEntry,
  CandidatePolicy,
  ChatCommand,
  ChatMessage,
  ChatResult,
  ControlPlaneState,
  EnforcementResult,
  PolicyVersion,
  WorkflowProgress,
  WorkflowStatus,
} from "../domain/policy";
export type AuthZenClient = ControlPlaneApiPort;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createAuthZenClient(fetcher: typeof fetch = fetch): ControlPlaneApiPort {
  return {
    async getState() {
      const body = await requestJson(fetcher, "/api/state");
      return parseControlPlaneState(body);
    },

    async enforceAccess(request) {
      const response = await fetcher(resolveApiUrl("/api/pep/enforce"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (response.status !== 200 && response.status !== 403) {
        throw await responseError(response);
      }
      const decision = parseAccessEvaluationResponse(await readJsonBody(response));
      const expectedStatus = decision.decision ? 200 : 403;
      if (response.status !== expectedStatus) {
        throw new ApiError(
          `PEP returned HTTP ${response.status} with a conflicting AuthZEN decision`,
          response.status,
        );
      }
      return { httpStatus: response.status, response: decision };
    },

    async postChat(command) {
      const body = await requestJson(fetcher, "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }, [200, 202]);
      if (isRecord(body) && typeof body.workflowId === "string") {
        return { workflowId: body.workflowId };
      }
      if (isRecord(body) && typeof body.explanation === "string") {
        return { explanation: body.explanation };
      }
      throw new ApiError("Worker returned an invalid chat response");
    },

    async getWorkflowStatus(workflowId, workspaceId = "default") {
      return parseWorkflowStatus(
        await requestJson(
          fetcher,
          `/api/workflows/${encodeURIComponent(workflowId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      );
    },

    async approvePolicy(candidateId) {
      return parsePolicyVersion(
        await requestJson(fetcher, "/api/policies/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        }),
      );
    },

    async getConfiguration() {
      return parseConfiguration(
        await requestJson(fetcher, "/.well-known/authzen-configuration"),
      );
    },
  };
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init?: RequestInit,
  acceptedStatuses: number[] = [200],
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl(url), init);
  if (!acceptedStatuses.includes(response.status)) {
    throw await responseError(response);
  }
  return readJsonBody(response);
}

async function readJsonBody(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("Worker returned an invalid JSON response", response.status);
  }
  return body;
}

async function responseError(response: Response): Promise<ApiError> {
  let message = `Request failed with HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.error === "string") message = body.error;
      else if (typeof body.message === "string") message = body.message;
    }
  } catch {
    message = `Request failed with HTTP ${response.status}`;
  }
  return new ApiError(message, response.status);
}

function parseControlPlaneState(value: unknown): ControlPlaneState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.policyVersions) ||
    !Array.isArray(value.auditLogs) ||
    !Array.isArray(value.chatMessages)
  ) {
    throw new ApiError("Worker returned an invalid control-plane state");
  }
  return {
    activePolicy: value.activePolicy === null ? null : parsePolicyVersion(value.activePolicy),
    candidatePolicy:
      value.candidatePolicy === null ? null : parseCandidatePolicy(value.candidatePolicy),
    policyVersions: value.policyVersions.map(parsePolicyVersion),
    auditLogs: value.auditLogs.map(parseAuditLogEntry),
    chatMessages: value.chatMessages.map(parseChatMessage),
  };
}

function parsePolicyVersion(value: unknown): PolicyVersion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.regoCode !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.activatedAt !== "string"
  ) {
    throw new ApiError("Worker returned an invalid policy version");
  }
  return {
    id: value.id,
    version: value.version,
    regoCode: value.regoCode,
    createdAt: value.createdAt,
    activatedAt: value.activatedAt,
  };
}

function parseCandidatePolicy(value: unknown): CandidatePolicy {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.regoCode !== "string" ||
    typeof value.originalPrompt !== "string" ||
    typeof value.explanation !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new ApiError("Worker returned an invalid candidate policy");
  }
  return {
    id: value.id,
    version: value.version,
    regoCode: value.regoCode,
    originalPrompt: value.originalPrompt,
    explanation: value.explanation,
    createdAt: value.createdAt,
  };
}

function parseAuditLogEntry(value: unknown): AuditLogEntry {
  if (
    !isRecord(value) ||
    typeof value.eventType !== "string" ||
    typeof value.occurredAt !== "string"
  ) {
    throw new ApiError("Worker returned an invalid audit log entry");
  }
  const id = typeof value.id === "number" ? value.id : undefined;
  const request = value.request === undefined ? undefined : parseAccessEvaluationRequest(value.request);
  const decision = value.response === undefined
    ? undefined
    : parseAccessEvaluationResponse(value.response);
  return {
    id,
    eventType: value.eventType,
    occurredAt: value.occurredAt,
    request,
    response: decision,
    details: value.details === undefined ? undefined : asRecord(value.details, "audit details"),
  };
}

function parseChatMessage(value: unknown): ChatMessage {
  if (
    !isRecord(value) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new ApiError("Worker returned an invalid chat message");
  }
  return {
    id: typeof value.id === "number" ? value.id : undefined,
    role: value.role,
    content: value.content,
    workflowId: typeof value.workflowId === "string" ? value.workflowId : undefined,
    createdAt: value.createdAt,
  };
}

function parseAccessEvaluationRequest(value: unknown): AccessEvaluationRequest {
  if (!isRecord(value) || !isRecord(value.subject) || !isRecord(value.resource) || !isRecord(value.action)) {
    throw new ApiError("Worker returned an invalid AuthZEN request in audit data");
  }
  if (
    typeof value.subject.type !== "string" ||
    typeof value.subject.id !== "string" ||
    typeof value.resource.type !== "string" ||
    typeof value.resource.id !== "string" ||
    typeof value.action.name !== "string"
  ) {
    throw new ApiError("Worker returned an invalid AuthZEN request in audit data");
  }
  return {
    subject: {
      type: value.subject.type,
      id: value.subject.id,
      properties: value.subject.properties === undefined
        ? undefined
        : asRecord(value.subject.properties, "subject properties"),
    },
    resource: {
      type: value.resource.type,
      id: value.resource.id,
      properties: value.resource.properties === undefined
        ? undefined
        : asRecord(value.resource.properties, "resource properties"),
    },
    action: {
      name: value.action.name,
      properties: value.action.properties === undefined
        ? undefined
        : asRecord(value.action.properties, "action properties"),
    },
    context: value.context === undefined ? undefined : asRecord(value.context, "request context"),
  };
}

function parseAccessEvaluationResponse(value: unknown): AccessEvaluationResponse {
  if (!isRecord(value) || typeof value.decision !== "boolean") {
    throw new ApiError("Worker returned an invalid AuthZEN decision");
  }
  if (value.context === undefined) return { decision: value.decision };
  const context = asRecord(value.context, "decision context");
  const reasons = context.reasons;
  const policyVersion = context.policy_version;
  if (
    (reasons !== undefined && !isStringArray(reasons)) ||
    (policyVersion !== undefined && typeof policyVersion !== "string")
  ) {
    throw new ApiError("Worker returned an invalid AuthZEN decision context");
  }
  return {
    decision: value.decision,
    context: {
      reasons,
      policy_version: policyVersion,
    },
  };
}

function parseConfiguration(value: unknown): AuthZenConfiguration {
  if (
    !isRecord(value) ||
    typeof value.policy_decision_point !== "string" ||
    typeof value.access_evaluation_endpoint !== "string"
  ) {
    throw new ApiError("Worker returned invalid AuthZEN discovery metadata");
  }
  return {
    policy_decision_point: value.policy_decision_point,
    access_evaluation_endpoint: value.access_evaluation_endpoint,
  };
}

function parseWorkflowStatus(value: unknown): WorkflowStatus {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new ApiError("Worker returned an invalid workflow status");
  }
  const status = isWorkflowStatus(value.status) ? value.status : "unknown";
  let error: WorkflowStatus["error"];
  if (isRecord(value.error) && typeof value.error.message === "string") {
    error = {
      name: typeof value.error.name === "string" ? value.error.name : "WorkflowError",
      message: value.error.message,
    };
  }
  let progress: WorkflowProgress | null | undefined;
  if (value.progress === null) {
    progress = null;
  } else if (value.progress !== undefined) {
    if (!isRecord(value.progress) || typeof value.progress.workflowId !== "string" ||
        typeof value.progress.updatedAt !== "string" || !isWorkflowStep(value.progress.step)) {
      throw new ApiError("Worker returned invalid workflow step progress");
    }
    progress = {
      workflowId: value.progress.workflowId,
      step: value.progress.step,
      updatedAt: value.progress.updatedAt,
    };
  }
  return { status, error, output: value.output, progress };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError(`Worker returned invalid ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isWorkflowStatus(value: string): value is WorkflowStatus["status"] {
  return [
    "queued",
    "running",
    "paused",
    "errored",
    "terminated",
    "complete",
    "waiting",
    "waitingForPause",
    "rollingBack",
    "unknown",
  ].includes(value);
}

function isWorkflowStep(value: unknown): value is WorkflowProgress["step"] {
  return value === "generate-rego-v1" ||
    value === "validate-with-opa" ||
    value === "auto-repair-if-invalid" ||
    value === "persist-candidate" ||
    value === "ready";
}