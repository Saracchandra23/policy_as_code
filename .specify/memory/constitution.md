# Project Constitution: cf_ai_policy_as_code

## Article I — Onion Architecture & Dependency Injection (Zero Globals)
1. **Strict Inward Dependencies**:
   - `domain` MUST have zero imports from `application`, `infrastructure`, `delivery`, `github.com/open-policy-agent/opa`, or Cloudflare runtime types.
   - `application` MAY import only `domain` and defines outbound Port interfaces (`PolicyDecisionPort`, `BundleRepositoryPort`, `PolicyStoragePort`, `AuthZenPDPPort`, `CopilotLLMPort`).
   - `infrastructure` implements `application` ports (OPA SDK adapter, local tarball bundle store, YAML config loader, Durable Object SQLite repository, AuthZEN HTTP client, Workers AI Llama 3.3 adapter).
   - `delivery` handles HTTP/Worker/Workflow transport and maps DTOs to `application` use cases.
2. **Proper Dependency Injection**:
   - Package-level singletons (`var instance`, `GetInstance()`) and service locators are FORBIDDEN.
   - Go dependencies MUST be wired exclusively via constructor functions (`New...`) inside `opa-service/internal/di/container.go` invoked from `cmd/server/main.go`.
   - TypeScript Worker dependencies MUST be wired exclusively inside `worker/src/di/container.ts` (`createContainer(env, ctx)`) and injected into `WorkerRouter` and `PolicyAuthoringWorkflow`.

## Article II — OpenID AuthZEN Authorization API 1.0 Contract
1. **Standard Wire Protocol**: PEP-to-PDP authorization checks MUST implement OpenID AuthZEN Authorization API 1.0 (`https://openid.net/specs/authorization-api-1_0.html`):
   - `POST /access/v1/evaluation` accepting `{ subject: { type, id, properties }, resource: { type, id, properties }, action: { name, properties }, context }` and returning `{ decision: boolean, context?: { reasons: string[], policy_version?: string } }`.
   - `GET /.well-known/authzen-configuration` returning PDP metadata (`policy_decision_point`, `access_evaluation_endpoint`).
2. **Embedded Go OPA & Local Bundle**:
   - `OPAEngineAdapter` wraps a single `*sdk.OPA` instance created once in `internal/di/container.go` using external YAML config (`OPA_CONFIG_PATH`, default `./config/opa-config.yaml`).
   - In-process bundle server serves `GET /bundle-server/bundles/bundle.tar.gz` with ETag revision headers, dynamically packing `.manifest`, `data.json`, and active `authz.rego`.

## Article III — Language Coding Guidelines
### Go (`/opa-service`)
- Target Go 1.24+; format with `gofmt`; zero unused variables or ignored errors.
- Pass `context.Context` as the first argument to all `application` and `infrastructure` methods.
- Wrap errors with `fmt.Errorf("context: %w", err)` and define domain sentinel errors (`ErrInvalidRego`, `ErrEngineNotReady`) in `internal/domain`.
- Guard mutable bundle state with `sync.RWMutex`.

### Rego (`/opa-service/policies` & LLM Prompts)
- Every policy MUST start with `package authz` and `import rego.v1`.
- Evaluate AuthZEN inputs (`input.subject`, `input.action`, `input.resource`, `input.context`) using Rego v1 keywords (`default allow := false`, `allow if { ... }`, `reasons contains msg if { ... }`, `in`).

### TypeScript & Cloudflare (`/worker`)
- Strict TypeScript (`"strict": true`, no `any`).
- Bindings in `wrangler.jsonc`: `AI`, `POLICY_DO` (`new_sqlite_classes`), `POLICY_WORKFLOW`.
- Parameterize all SQLite queries in `this.ctx.storage.sql.exec(...)`.
- Use `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for Rego generation and AuthZEN denial explanations.

### React & Frontend (`/frontend`)
- Functional TypeScript components sending OpenID AuthZEN 1.0 `AccessEvaluationRequest` payloads to `/api/evaluate`.

## Article IV — Spec-Kit & Prompt Traceability
1. Trace `Epic -> Topic -> Spec -> Plan -> Tasks` before writing implementation code.
2. Append every substantive prompt executed to `PROMPTS.md`.
