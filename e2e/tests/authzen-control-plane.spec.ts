import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const WORKER_URL = "http://127.0.0.1:8787";
const OPA_URL = "http://127.0.0.1:8080";
const POLICY_PROMPT =
  "Allow users with the viewer role to publish draft reports. Keep the existing rules unchanged.";

interface AccessEvaluationRequest {
  subject: { type: string; id: string; properties?: Record<string, unknown> };
  resource: { type: string; id: string; properties?: Record<string, unknown> };
  action: { name: string };
  context?: Record<string, unknown>;
}

interface AccessEvaluationResponse {
  decision: boolean;
  context?: { reasons?: string[]; policy_version?: string };
}

interface ControlPlaneState {
  activePolicy: { version: string; regoCode: string } | null;
  candidatePolicy: {
    id: string;
    version: string;
    regoCode: string;
  } | null;
  policyVersions: Array<{ version: string }>;
  auditLogs: Array<{
    eventType: string;
    request?: AccessEvaluationRequest;
    response?: AccessEvaluationResponse;
  }>;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

const viewerPublishRequest: AccessEvaluationRequest = {
  subject: {
    type: "user",
    id: "alice",
    properties: { role: "viewer", roles: ["viewer"] },
  },
  resource: {
    type: "report",
    id: "report-1",
    properties: { owner: "bob", status: "draft" },
  },
  action: { name: "publish_report" },
  context: { authenticated: true },
};

test.describe("OpenID AuthZEN control plane", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(
        async () =>
          (
            await request.post(`${OPA_URL}/access/v1/evaluation`, {
              data: {
                subject: {
                  type: "user",
                  id: "carol",
                  properties: { roles: ["admin"] },
                },
                resource: { type: "workspace", id: "workspace-prod" },
                action: { name: "delete_workspace" },
                context: { authenticated: true },
              } satisfies AccessEvaluationRequest,
            })
          ).status(),
        { timeout: 30_000, intervals: [250, 500, 1_000] },
      )
      .toBe(200);
  });

  test("discovers AuthZEN metadata and reports Go OPA health", async ({ request }) => {
    const [discoveryResponse, healthResponse] = await Promise.all([
      request.get(`${WORKER_URL}/.well-known/authzen-configuration`),
      request.get(`${OPA_URL}/health`),
    ]);

    expect(discoveryResponse.status()).toBe(200);
    const discovery = (await discoveryResponse.json()) as Record<string, unknown>;
    expect(typeof discovery.policy_decision_point).toBe("string");
    expect(typeof discovery.access_evaluation_endpoint).toBe("string");
    expect(new URL(discovery.policy_decision_point as string).host).toBeTruthy();
    expect(new URL(discovery.access_evaluation_endpoint as string).pathname).toBe(
      "/access/v1/evaluation",
    );

    expect(healthResponse.status()).toBe(200);
    expect(await healthResponse.json()).toMatchObject({ status: "ok" });
  });

  test("allows an editor to publish a draft report and persists the audit event", async ({
    page,
    request,
  }) => {
    const initialState = await getState(request);
    await page.goto("/");
    await page.getByLabel("Persona").selectOption("bob");
    await page.getByLabel("Resource").selectOption("report-1");

    const responsePromise = watchPepResponse(page);
    await page.getByRole("button", { name: "publish_report" }).click();
    const pepResponse = await responsePromise;

    expect(pepResponse.status()).toBe(200);
    const result = (await pepResponse.json()) as AccessEvaluationResponse;
    expect(result.decision).toBe(true);
    await expect(page.getByText("200 ALLOW", { exact: true })).toBeVisible();

    await page.getByText("Raw AuthZEN request / response").click();
    await expect(page.getByText('"decision": true', { exact: false })).toBeVisible();
    await expect
      .poll(async () => (await getState(request)).auditLogs.length)
      .toBeGreaterThan(initialState.auditLogs.length);
    await expect(
      page.getByRole("table").getByRole("row").filter({ hasText: "bob / publish_report" }),
    ).toBeVisible();
  });

  test("denies a viewer's workspace deletion and explains the denial", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page.getByLabel("Persona").selectOption("alice");
    await page.getByLabel("Resource").selectOption("workspace-prod");

    const responsePromise = watchPepResponse(page);
    await page.getByRole("button", { name: "delete_workspace" }).click();
    const pepResponse = await responsePromise;

    expect(pepResponse.status()).toBe(403);
    const result = (await pepResponse.json()) as AccessEvaluationResponse;
    expect(result.decision).toBe(false);
    expect(result.context?.reasons?.length).toBeGreaterThan(0);
    await expect(page.getByText("403 DENY", { exact: true })).toBeVisible();
    await expect(page.locator(".decision-banner")).toContainText(/authorization/i);

    const explanationResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /explain last denial/i }).click();
    const explanationResponse = await explanationResponsePromise;
    expect(explanationResponse.status()).toBe(200);
    const explanationResult = (await explanationResponse.json()) as { explanation: string };
    expect(explanationResult.explanation.trim().length).toBeGreaterThan(20);
    await expect(page.getByText(explanationResult.explanation, { exact: true })).toBeVisible();

    await expect
      .poll(async () =>
        (await getState(request)).chatMessages.some(
          (message) => message.role === "assistant" && message.content === explanationResult.explanation,
        ),
      )
      .toBe(true);
  });

  test("authors, validates, approves, and hot-syncs an AI policy", async ({ page, request }) => {
    const initialState = await getState(request);
    expect(initialState.activePolicy).not.toBeNull();
    const originalVersion = initialState.activePolicy?.version;
    const originalVersionCount = initialState.policyVersions.length;
    const originalETag = await getBundleETag(request);
    expect((await evaluateAtPDP(request, viewerPublishRequest)).decision).toBe(false);

    await page.goto("/");
    await page.getByRole("textbox", { name: "Describe a policy rule" }).fill(POLICY_PROMPT);
    const authoringResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Generate policy" }).click();
    const authoringResponse = await authoringResponsePromise;
    expect(authoringResponse.status()).toBe(202);
    const { workflowId } = (await authoringResponse.json()) as { workflowId: string };
    expect(workflowId).toBeTruthy();

    await expect
      .poll(async () => {
        const statusResponse = await request.get(`${WORKER_URL}/api/workflows/${workflowId}`);
        expect(statusResponse.status()).toBe(200);
        const status = (await statusResponse.json()) as {
          status: string;
          progress?: { step?: string };
        };
        return status.status === "complete" && status.progress?.step === "ready";
      }, { timeout: 120_000, intervals: [1_000, 2_000, 3_000] })
      .toBe(true);

    const candidateState = await getState(request);
    expect(candidateState.candidatePolicy).not.toBeNull();
    expect(candidateState.candidatePolicy?.regoCode).toMatch(
      /^package authz\n\nimport rego\.v1/m,
    );
    await expect(page.getByRole("region", { name: "Line-by-line policy diff" })).toBeVisible();
    await expect(page.getByText("OPA validation passed", { exact: true })).toBeVisible();

    const approvalResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/policies/approve") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & Sync to OPA Bundle" }).click();
    const approvalResponse = await approvalResponsePromise;
    expect(approvalResponse.status()).toBe(200);

    await expect
      .poll(async () => {
        const state = await getState(request);
        return (
          state.activePolicy?.version !== originalVersion &&
          state.policyVersions.length > originalVersionCount &&
          state.candidatePolicy === null
        );
      })
      .toBe(true);
    expect(await getBundleETag(request)).not.toBe(originalETag);

    await expect
      .poll(async () => (await evaluateAtPDP(request, viewerPublishRequest)).decision, {
        timeout: 30_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(true);

    await page.getByLabel("Persona").selectOption("alice");
    await page.getByLabel("Resource").selectOption("report-1");
    const pepResponsePromise = watchPepResponse(page);
    await page.getByRole("button", { name: "publish_report" }).click();
    expect((await pepResponsePromise).status()).toBe(200);
    await expect(page.getByText("200 ALLOW", { exact: true })).toBeVisible();
  });

  test("retains the active Rego, audit events, and chat history after reload", async ({
    page,
    request,
  }) => {
    const stateBeforeReload = await getState(request);
    expect(stateBeforeReload.activePolicy).not.toBeNull();
    expect(stateBeforeReload.auditLogs.length).toBeGreaterThan(0);
    expect(stateBeforeReload.chatMessages.length).toBeGreaterThan(0);
    expect(
      stateBeforeReload.chatMessages.some((message) => message.content === POLICY_PROMPT),
    ).toBe(true);
    const persistedExplanation = stateBeforeReload.chatMessages.find(
      (message) => message.role === "assistant",
    );
    expect(persistedExplanation).toBeDefined();

    await page.goto("/");
    await page.reload();
    await expect
      .poll(() => page.locator(".rego-code").textContent())
      .toBe(stateBeforeReload.activePolicy?.regoCode ?? "");
    await expect(page.getByText(POLICY_PROMPT, { exact: true })).toBeVisible();
    await expect(
      page.getByText(persistedExplanation?.content ?? "", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByRole("row").filter({ hasText: "bob / publish_report" }),
    ).toBeVisible();

    const stateAfterReload = await getState(request);
    expect(stateAfterReload.activePolicy?.version).toBe(stateBeforeReload.activePolicy?.version);
    expect(stateAfterReload.auditLogs.length).toBe(stateBeforeReload.auditLogs.length);
    expect(stateAfterReload.chatMessages.length).toBe(stateBeforeReload.chatMessages.length);
  });
});

async function getState(request: APIRequestContext): Promise<ControlPlaneState> {
  const response = await request.get(`${WORKER_URL}/api/state`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ControlPlaneState;
}

async function getBundleETag(request: APIRequestContext): Promise<string | undefined> {
  const response = await request.get(
    `${OPA_URL}/bundle-server/bundles/bundle.tar.gz`,
  );
  expect(response.status()).toBe(200);
  return response.headers().etag;
}

async function evaluateAtPDP(
  request: APIRequestContext,
  evaluation: AccessEvaluationRequest,
): Promise<AccessEvaluationResponse> {
  const response = await request.post(`${OPA_URL}/access/v1/evaluation`, {
    data: evaluation,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as AccessEvaluationResponse;
}

function watchPepResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/pep/enforce") && response.request().method() === "POST",
  );
}
