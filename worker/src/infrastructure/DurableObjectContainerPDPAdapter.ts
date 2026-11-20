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

export class DurableObjectContainerPDPAdapter implements AuthZenPDPPort {
  private startup: Promise<Fetcher> | undefined;

  constructor(private readonly container: Container) {}

  async evaluate(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse> {
    const response = await this.request("/access/v1/evaluation", {
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
    const response = await this.request("/validate", {
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
    return {
      valid: result.valid,
      errors: result.errors ?? (result.message ? [result.message] : []),
    };
  }

  async syncPolicy(regoCode: string, version: string): Promise<void> {
    const response = await this.request("/policies/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rego: regoCode,
        data: { metadata: { policy_version: version } },
      }),
    });
    const result = await readJson<SyncResponse>(response, "/policies/sync");
    if (!response.ok || result.synced !== true || typeof result.revision !== "string") {
      throw new Error(
        `OPA policy synchronization failed (${response.status}): ${JSON.stringify(result)}`,
      );
    }
  }

  async getConfiguration(): Promise<AuthZenConfiguration> {
    const response = await this.request("/.well-known/authzen-configuration");
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

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const port = await this.readyPort();
    return port.fetch(`http://container${path}`, init);
  }

  private readyPort(): Promise<Fetcher> {
    this.startup ??= this.startAndWait().catch((error: unknown) => {
      this.startup = undefined;
      throw error;
    });
    return this.startup;
  }

  private async startAndWait(): Promise<Fetcher> {
    const port = this.container.getTcpPort(8080);
    this.container.start();
    await this.container.setInactivityTimeout(300_000);

    const deadline = Date.now() + 30_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          return port;
        }
        lastError = new Error(
          `OPA health returned HTTP ${response.status}: ${await response.text()}`,
        );
      } catch (error) {
        lastError = error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`OPA container did not become healthy within 30 seconds${detail}`, {
      cause: lastError,
    });
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
      `OPA container endpoint ${endpoint} returned non-JSON content (HTTP ${response.status}, ${contentType})${preview ? `: ${preview}` : ""}`,
      { cause: error },
    );
  }
  if (body === null || typeof body !== "object") {
    throw new Error(`OPA container endpoint ${endpoint} returned a non-object JSON response`);
  }
  return body as T;
}
