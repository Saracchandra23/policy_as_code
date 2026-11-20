import type { AuthZenPDPPort } from "../application/ports";
import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
  AuthZenConfiguration,
} from "../domain/authzen";
import type { ValidationResult } from "../domain/policy";

interface ValidateResponse {
  valid: boolean;
  errors?: string[];
  message?: string;
}

interface SyncResponse {
  revision: string;
  synced: boolean;
}

export class HttpAuthZenPDPAdapter implements AuthZenPDPPort {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    opaServiceUrl: string,
    fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.baseUrl = opaServiceUrl.replace(/\/+$/, "");
    this.fetcher = fetcher.bind(globalThis);
  }

  async evaluate(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    const response = await this.fetcher(this.url("/access/v1/evaluation"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await readJson<AccessEvaluationResponse>(response, "/access/v1/evaluation");
    if (!response.ok) {
      throw new Error(`OPA evaluation failed (${response.status}): ${JSON.stringify(result)}`);
    }
    if (typeof result.decision !== "boolean") {
      throw new Error("OPA evaluation returned an invalid AuthZEN decision");
    }
    return result;
  }

  async validateRego(regoCode: string): Promise<ValidationResult> {
    const response = await fetchValidationWithRetry(this.fetcher, this.url("/validate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rego: regoCode }),
    });
    const result = await readJson<ValidateResponse>(response, "/validate");
    if (response.status >= 500) {
      throw new Error(`OPA validation failed (${response.status}): ${JSON.stringify(result)}`);
    }
    if (typeof result.valid !== "boolean") {
      throw new Error("OPA validation returned an invalid response");
    }
    const errors = result.errors ?? (result.message ? [result.message] : []);
    return { valid: result.valid, errors };
  }

  async syncPolicy(regoCode: string, version: string): Promise<void> {
    const response = await this.fetcher(this.url("/policies/sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rego: regoCode,
        data: { metadata: { policy_version: version } },
      }),
    });
    const result = await readJson<SyncResponse>(response, "/policies/sync");
    if (!response.ok || result.synced !== true || typeof result.revision !== "string") {
      throw new Error(`OPA policy synchronization failed (${response.status}): ${JSON.stringify(result)}`);
    }
  }

  async getConfiguration(): Promise<AuthZenConfiguration> {
    const response = await this.fetcher(this.url("/.well-known/authzen-configuration"));
    const configuration = await readJson<AuthZenConfiguration>(
      response,
      "/.well-known/authzen-configuration",
    );
    if (!response.ok) {
      throw new Error(`OPA discovery failed (${response.status}): ${JSON.stringify(configuration)}`);
    }
    if (
      typeof configuration.policy_decision_point !== "string" ||
      typeof configuration.access_evaluation_endpoint !== "string"
    ) {
      throw new Error("OPA discovery returned invalid AuthZEN metadata");
    }
    return configuration;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

async function readJson<T>(response: Response, endpoint: string): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `OPA endpoint ${endpoint} returned non-JSON content (HTTP ${response.status}, ${contentType})${preview ? `: ${preview}` : ""}`,
      { cause: error },
    );
  }
  if (body === null || typeof body !== "object") {
    throw new Error(`OPA endpoint ${endpoint} returned a non-object JSON response`);
  }
  return body as T;
}

async function fetchValidationWithRetry(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const retryDelays = [1_000, 2_000, 4_000, 8_000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetcher(url, init);
    if (![502, 503, 504].includes(response.status) || attempt === retryDelays.length) {
      return response;
    }

    await response.body?.cancel();
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(retryAfterSeconds * 1_000, 10_000)
      : retryDelays[attempt];
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}
