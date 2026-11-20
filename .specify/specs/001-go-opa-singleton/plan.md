# Implementation Plan: 001-go-opa-singleton

## Constitutional Constraints

- Target Go 1.24+ and use `gofmt`.
- Keep strict Onion dependency direction and zero package-level service globals.
- Create the embedded OPA SDK once per application container using external YAML at `OPA_CONFIG_PATH`.
- Protect mutable bundle data with `sync.RWMutex`; generate deterministic tar+gzip bundle revisions and ETags.
- Use Rego v1 and domain sentinel errors.
- Serve OpenID AuthZEN Authorization API 1.0 evaluation and discovery contracts.

## Constitution Check

- [ ] **Onion dependency rule**: domain imports neither application, infrastructure, delivery, nor SDK packages.
- [ ] **Application ports**: use cases depend on domain types and outbound interfaces only.
- [ ] **Zero globals**: no package-level OPA instances, `sync.Once`, service locators, or mutable service state.
- [ ] **Constructor DI**: `opa-service/internal/di/container.go` constructs the OPA SDK adapter, bundle repository, use cases, and HTTP handler; `cmd/server/main.go` only creates and runs the container.
- [ ] **External YAML**: configuration is loaded through `OPA_CONFIG_PATH` (default `./config/opa-config.yaml`).
- [ ] **In-process bundle**: `.manifest`, `data.json`, and active `authz.rego` are generated from thread-safe memory and served with an ETag revision.
- [ ] **AuthZEN 1.0**: evaluation request, decision response, and discovery metadata match the contracts below.
- [ ] **Rego v1**: every policy and fixture begins with `package authz` and `import rego.v1`.
- [ ] **Traceability**: implementation tasks trace this plan to `TOPIC-01` and `EPIC-01`.

## Onion Architecture Folder Contracts

```text
opa-service/
├── cmd/server/main.go                 # Starts the injected application container
├── config/opa-config.yaml             # External OPA SDK configuration
├── internal/
│   ├── domain/
│   │   ├── policy.go                  # PolicyDocument, Revision, BundleSnapshot
│   │   ├── decision.go                # AuthZEN subject/resource/action/context and decision
│   │   └── errors.go                  # ErrInvalidRego, ErrEngineNotReady
│   ├── application/
│   │   ├── ports.go                   # PolicyDecisionPort, BundleRepositoryPort
│   │   └── usecases.go                # Evaluate, Validate, SyncPolicy, DiscoverPDP
│   ├── infrastructure/
│   │   ├── opa_engine.go              # OPAEngineAdapter around one *sdk.OPA
│   │   ├── yaml_config.go             # OPA_CONFIG_PATH loader
│   │   └── bundle_store.go            # RWMutex state and tar/gzip generation
│   ├── delivery/http/
│   │   ├── router.go                  # AuthZEN and policy routes
│   │   └── dto.go                     # AuthZEN wire DTOs and policy DTOs
│   └── di/
│       └── container.go               # Constructor-based dependency graph; no globals
└── policies/
    ├── authz.rego                     # Seed Rego v1 policy
    └── data.json                      # Seed authorization data
```

### Dependency Injection Container

The container owns the application lifetime and all concrete instances. Construction receives runtime/configuration inputs and returns an initialized dependency graph; there are no package-level instances or accessors.

```go
type Container struct {
    Handler http.Handler
    OPA     *sdk.OPA
}

func NewContainer(ctx context.Context, configPath string) (*Container, error)
```

`NewContainer` loads configuration, constructs the bundle store and OPA SDK once, builds the application use cases and HTTP delivery, and returns errors to `cmd/server/main.go`. `main.go` invokes the constructor and serves `Container.Handler`.

The Worker uses the corresponding constructor-only composition contract:

```typescript
// worker/src/di/container.ts
interface WorkerContainer {
  router: WorkerRouter;
  policyAuthoringWorkflow: PolicyAuthoringWorkflowService;
}

function createContainer(env: Env, ctx: ExecutionContext): WorkerContainer;
```

`createContainer` constructs Worker adapters and use cases from its explicit arguments. Both containers avoid package/module-level service instances, service locators, and mutable global dependencies.

## Application Port Contracts

```go
type PolicyDecisionPort interface {
    Evaluate(context.Context, domain.AccessEvaluationRequest) (domain.AccessEvaluationResponse, error)
    Validate(context.Context, string) error
}

type BundleRepositoryPort interface {
    Sync(context.Context, domain.PolicyDocument) (domain.Revision, error)
    Snapshot(context.Context) (domain.BundleSnapshot, error)
}
```

## OpenID AuthZEN Authorization API 1.0 Contracts

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
  "context": {"reasons": ["authorization granted"], "policy_version": "revision"}
}
```

`context` in the response is optional. When returned, it contains `reasons` and may contain `policy_version`.

### GET /.well-known/authzen-configuration

Response:

```json
{
  "policy_decision_point": "https://pdp.example",
  "access_evaluation_endpoint": "https://pdp.example/access/v1/evaluation"
}
```

The metadata endpoint and evaluation endpoint use the same configured public PDP base URL. `/validate`, `/policies/sync`, and `/bundle-server/bundles/bundle.tar.gz` remain service-specific routes.
