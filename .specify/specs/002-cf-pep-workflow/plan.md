# Implementation Plan: 002-cf-pep-workflow

## Constitutional Constraints

- Use strict TypeScript and no `any`.
- Keep all durable state behind Durable Object SQLite APIs and parameterize every query.
- Keep strict Onion dependency direction and zero package-level service globals.
- Construct Worker dependencies through `worker/src/di/container.ts`.
- Use Workers AI Llama 3.3 for generation and denial explanations.
- Activate only Rego v1 policies after PDP validation.
- Use the OpenID AuthZEN Authorization API 1.0 wire contract between PEP and PDP.

## Constitution Check

- [ ] **Onion dependency rule**: domain code has no Worker runtime or Cloudflare SDK imports.
- [ ] **Application ports**: repository, LLM, and AuthZEN PDP ports are explicit interfaces.
- [ ] **Infrastructure adapters**: Durable Object SQLite, Workers AI, and AuthZEN HTTP clients implement application ports.
- [ ] **Delivery boundary**: Worker, Durable Object, and Workflow classes map DTOs to use cases.
- [ ] **Zero globals**: no package-level service instances, service locators, or mutable dependency caches.
- [ ] **Constructor DI**: `worker/src/di/container.ts` exports `createContainer(env, ctx)` and injects dependencies into the Worker router and Workflow.
- [ ] **SQLite binding**: every SQL call uses `this.ctx.storage.sql.exec(...)` with bound parameters.
- [ ] **Wrangler bindings**: `AI`, `POLICY_DO`, and `POLICY_WORKFLOW` are configured.
- [ ] **AuthZEN 1.0**: PEP-to-PDP evaluation and PDP discovery use the exact contracts below.
- [ ] **Rego v1**: generation, repair, validation, and activation require Rego v1 policy headers.

## Onion Architecture Folder Contracts

```text
worker/src/
├── domain/
│   ├── authorization.ts               # AuthZEN evaluation and decision domain models
│   ├── policy.ts                      # PolicyVersion and policy data types
│   ├── audit.ts                       # AuditEntry and ChatMessage
│   └── errors.ts                      # Typed domain errors
├── application/
│   ├── ports.ts                       # AuthZenPDPPort, PolicyStoragePort, CopilotLLMPort
│   └── use_cases.ts                   # Evaluate, SyncPolicy, GeneratePolicy, ExplainDenial
├── infrastructure/
│   ├── authzen_pdp_client.ts           # AuthZenPDPPort HTTP implementation
│   ├── workers_ai.ts                  # CopilotLLMPort implementation
│   └── sqlite_repository.ts           # PolicyStoragePort implementation
├── delivery/
│   ├── index.ts                       # Runtime export; obtains injected container
│   ├── worker_router.ts               # PEP routes and DTO mapping
│   ├── durable_object.ts              # PolicyEngineDO transport adapter
│   └── workflow.ts                    # PolicyAuthoringWorkflow transport adapter
└── di/
    └── container.ts                   # createContainer(env, ctx), no globals
```

`wrangler.jsonc` provides `AI`, `POLICY_DO`, `POLICY_WORKFLOW`, and the configured Go PDP base URL. The delivery entry point constructs the request-scoped graph through the DI container and passes it to routes/workflow adapters; domain and application modules do not access bindings directly.

## Constructor-Based Dependency Injection Container

```typescript
interface WorkerContainer {
  router: WorkerRouter;
  policyAuthoringWorkflow: PolicyAuthoringWorkflowService;
}

function createContainer(env: Env, ctx: ExecutionContext): WorkerContainer;
```

`createContainer` constructs the AuthZEN client, policy storage adapter, Workers AI adapter, use cases, router, and workflow service using the supplied environment and execution context. It returns the graph; no singleton module state or global service registry is allowed.

The Go PDP uses the corresponding constructor-only composition contract:

```go
// opa-service/internal/di/container.go
type Container struct {
    Handler http.Handler
    OPA     *sdk.OPA
}

func NewContainer(ctx context.Context, configPath string) (*Container, error)
```

`NewContainer` constructs the OPA SDK instance, adapters, use cases, and HTTP delivery per application lifetime and returns the graph to `opa-service/cmd/server/main.go`. Neither server container uses package-level dependency state.

## Application Port Contracts

```typescript
interface AuthZenPDPPort {
  evaluate(request: AccessEvaluationRequest): Promise<AccessEvaluationResponse>;
  discover(): Promise<AuthZenConfiguration>;
  validate(rego: string): Promise<ValidationResult>;
  sync(rego: string, data: JsonObject): Promise<PolicyRevision>;
}

interface PolicyStoragePort {
  savePolicy(policy: PolicyVersion): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
  appendChat(message: ChatMessage): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
}

interface CopilotLLMPort {
  generateRego(prompt: string, currentRego?: string): Promise<string>;
  explainDenial(decision: AccessEvaluationResponse): Promise<string>;
}
```

## OpenID AuthZEN Authorization API 1.0 Contracts

The PEP's `AuthZenPDPPort` calls the PDP directly:

### POST /access/v1/evaluation

Request:

```json
{
  "subject": {"type": "user", "id": "alice", "properties": {}},
  "resource": {"type": "document", "id": "doc-1", "properties": {}},
  "action": {"name": "read", "properties": {}},
  "context": {}
}
```

Response:

```json
{
  "decision": true,
  "context": {"reasons": ["read action is allowed"], "policy_version": "revision"}
}
```

`context` is optional; when present it contains `reasons` and may contain `policy_version`. The PEP preserves the `decision` and context data in its response, attaching an optional AI denial explanation without changing the AuthZEN decision.

### GET /.well-known/authzen-configuration

Response:

```json
{
  "policy_decision_point": "https://pdp.example",
  "access_evaluation_endpoint": "https://pdp.example/access/v1/evaluation"
}
```

The PEP uses this metadata to resolve the PDP endpoint when configured for discovery; upstream and malformed-request errors are explicit failures, never allow-shaped fallbacks.
