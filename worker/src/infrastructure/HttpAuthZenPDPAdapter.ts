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

  constructor(
    opaServiceUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = opaServiceUrl.replace(/\/+$/, "");
  }

  async evaluate(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    const response = await this.fetcher(this.url("/access/v1/evaluation"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await readJson<AccessEvaluationResponse>(response);
    if (!response.ok) {
      throw new Error(`OPA evaluation failed (${response.status}): ${JSON.stringify(result)}`);
    }
    if (typeof result.decision !== "boolean") {
      throw new Error("OPA evaluation returned an invalid AuthZEN decision");
    }
    return result;
  }

  async validateRego(regoCode: string): Promise<ValidationResult> {
    const response = await this.fetcher(this.url("/validate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rego: regoCode }),
    });
    const result = await readJson<ValidateResponse>(response);
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
    const result = await readJson<SyncResponse>(response);
    if (!response.ok || result.synced !== true || typeof result.revision !== "string") {
      throw new Error(`OPA policy synchronization failed (${response.status}): ${JSON.stringify(result)}`);
    }
  }

  async getConfiguration(): Promise<AuthZenConfiguration> {
    const response = await this.fetcher(this.url("/.well-known/authzen-configuration"));
    const configuration = await readJson<AuthZenConfiguration>(response);
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

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object") {
    throw new Error("OPA returned a non-object JSON response");
  }
  return body as T;
}
