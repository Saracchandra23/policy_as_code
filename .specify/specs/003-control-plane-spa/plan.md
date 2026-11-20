# Implementation Plan: 003-control-plane-spa

## Constitutional Constraints

- Use React functional TypeScript components and strict API client DTOs.
- Separate application state from presentation.
- Explicitly handle loading, `200 ALLOW`, `403 DENY`, and transport failures.
- Keep no raw `any` types in application or API code.
- Use OpenID AuthZEN Authorization API 1.0 evaluation and discovery payloads.
- Keep service dependency construction inside the Go and Worker constructor-based DI containers; frontend modules do not use global service registries.

## Constitution Check

- [ ] **Onion boundary**: frontend domain/application contracts do not depend on React or infrastructure implementations.
- [ ] **State separation**: controllers/hooks own async state; presentation components remain typed.
- [ ] **Strict DTOs**: API request and response types match the Worker and AuthZEN contracts below.
- [ ] **AuthZEN 1.0**: simulator sends the standard access evaluation request and renders the standard decision response.
- [ ] **DI containers**: Go dependencies are constructed by `opa-service/internal/di/container.go`; Worker dependencies by `worker/src/di/container.ts`; no globals or service locators.
- [ ] **Cloudflare deployment**: Vite output is a static Cloudflare Pages-compatible SPA.
- [ ] **Authorization states**: loading, allow, deny, and failure states are explicit and mutually distinguishable.
- [ ] **Policy approval**: synchronization only follows approval of a visible diff.
- [ ] **Traceability**: implementation tasks trace this plan to `TOPIC-03` and `EPIC-01`.

## Onion Architecture Folder Contracts

```text
frontend/src/
├── domain/
│   ├── authorization.ts               # AuthZEN request/response types
│   ├── policy.ts                      # Revisions, diffs, validation states
│   └── audit.ts                       # Audit and chat domain types
├── application/
│   ├── ports.ts                       # PolicyApiPort, AuditStreamPort, CopilotPort
│   └── controllers.ts                 # Evaluate, sync, generate, and stream workflows
├── infrastructure/
│   ├── api_client.ts                  # Typed fetch implementation
│   └── audit_stream.ts                # Polling or streaming adapter
├── delivery/
│   ├── App.tsx                        # UI composition
│   ├── components/
│   └── hooks/
└── main.tsx                           # Browser entry point
```

The SPA constructs typed API adapters at the browser entry point and passes them to controllers/components. It does not own service singletons or global mutable dependency state.

## Constructor-Based Service DI Container Contracts

Every feature plan shares these service composition contracts; the SPA consumes the Worker API and does not instantiate either server's container:

```go
// opa-service/internal/di/container.go
type Container struct {
    Handler http.Handler
    OPA     *sdk.OPA
}

func NewContainer(ctx context.Context, configPath string) (*Container, error)
```

The Go container constructs one OPA engine adapter, repositories, use cases, and HTTP delivery per application lifetime and is invoked by `opa-service/cmd/server/main.go`. It contains no package-level singleton.

```typescript
// worker/src/di/container.ts
interface WorkerContainer {
  router: WorkerRouter;
  policyAuthoringWorkflow: PolicyAuthoringWorkflowService;
}

function createContainer(env: Env, ctx: ExecutionContext): WorkerContainer;
```

The Worker container constructs its AuthZEN client, SQLite, Workers AI, use cases, router, and workflow service from explicit bindings/context. `worker/src/delivery/index.ts` injects the returned graph. Neither container uses a global service locator or mutable global dependencies.

## Frontend Port Contracts

```typescript
interface PolicyApiPort {
  evaluate(input: AccessEvaluationRequest): Promise<AccessEvaluationResponse>;
  sync(policy: PolicyDraft): Promise<PolicyRevision>;
  startGeneration(prompt: CopilotPrompt): Promise<WorkflowStart>;
}

interface AuditStreamPort {
  read(limit: number): Promise<AuditEntry[]>;
  subscribe(onEntry: (entry: AuditEntry) => void): () => void;
}

interface CopilotPort {
  send(prompt: CopilotPrompt): Promise<CopilotResponse>;
  subscribe(workflowId: string): AsyncIterable<CopilotUpdate>;
}
```

## OpenID AuthZEN Authorization API 1.0 Contracts

The simulator sends the standard request through the Worker PEP, which forwards it to the PDP:

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

The optional response `context` carries `reasons` and may carry `policy_version`. The UI maps `decision: true` to `200 ALLOW` and `decision: false` to `403 DENY`, with pending and transport-error states kept distinct.

### GET /.well-known/authzen-configuration

Response:

```json
{
  "policy_decision_point": "https://pdp.example",
  "access_evaluation_endpoint": "https://pdp.example/access/v1/evaluation"
}
```

The typed client may use PDP metadata for discovery; the Worker remains the authorization PEP and frontend-facing API.
