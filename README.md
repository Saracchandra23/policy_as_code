# AI-Assisted Policy-as-Code Control Plane

**Live demo:** <ADD_CLOUDFLARE_PAGES_URL>

`cf_ai_policy_as_code` is an authorization control plane for authoring, validating, reviewing, and activating Rego policies. The React control plane sends OpenID AuthZEN 1.0 requests through a Cloudflare Worker PEP. A Durable Object owns SQLite policy, chat, and decision state and selects either an in-process Cloudflare Container Go OPA PDP or an HTTP PDP. Cloudflare Workflows coordinate Workers AI generation, OPA validation, repair, and candidate persistence.

## Architecture

```text
                 +----------------------------+
                 | Cloudflare Pages           |
                 | React 19 control plane     |
                 +-------------+--------------+
                               | AuthZEN / control-plane API
                               v
 +-----------------------------+------------------------------------+
 | Cloudflare Worker PEP + AuthZEN 1.0 endpoints                    |
 | POST /access/v1/evaluation     GET /.well-known/authzen-configuration |
 +---------------+----------------------------------+---------------+
                 |                                  |
                 v                                  v
 +-------------------------------+     +----------------------------+
 | Durable Object: PolicyEngineDO|     | Cloudflare Workflows       |
 | Constructor-injected use cases|<--->| generate -> validate       |
 | SQLite policy/audit/chat state|     | -> repair -> persist       |
 +-----+-------------------------+     +--------------+-------------+
       |                                             |
       | Cloudflare production                       v
       v                                +----------------------------+
 +-------------------------------+     | Workers AI                 |
 | Native Cloudflare Container   |     | Llama 3.3                  |
 | Go OPA PDP (`opa/v1/sdk`)     |     +----------------------------+
 | tar.gz bundle server + ETags  |
 +-------------------------------+
       ^
       | HTTP PDP (Docker Compose / Free Tier)
 +-----+-------------------------+
 | Go OPA service                |
 | Onion layers + DI composition|
 +-------------------------------+

 Onion boundaries:
   Go:     Delivery -> Application -> Domain <- Infrastructure
   Worker: Delivery -> Application -> Domain <- Infrastructure
   DI composition roots wire concrete adapters; no service singletons.
```

In Cloudflare production, `PolicyEngineDO` uses the native Containers binding and starts the Go OPA image on demand. In local Docker Compose and Workers Free Tier configurations without that binding, the same PDP port uses `OPA_SERVICE_URL` over HTTP. The Go service exposes `POST /access/v1/evaluation`, `GET /.well-known/authzen-configuration`, `POST /validate`, and `POST /policies/sync`; its in-process bundle server supplies versioned tarballs with ETags.

### Cloudflare assignment primitives

| Primitive | Implementation |
| --- | --- |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` generates and repairs Rego v1 and explains denials. |
| Workflow / Coordination | Cloudflare Workflows coordinate policy retrieval, generation, Go OPA validation, repair, and candidate persistence. |
| User Input | The React SPA provides the PEP simulator, AuthZEN inspector, policy diff and approval, and natural-language authoring chat. |
| Memory / State | SQLite-backed Durable Objects persist active/candidate policies, authorization records, chat, and workflow progress. |

Authorization decisions use the AuthZEN 1.0 `POST /access/v1/evaluation` contract. The Worker PEP returns `200` for an allow and `403` for a deny; the Go PDP is independently addressable using the same contract.

## Enterprise use cases and business benefits

- **Separate PEP from PDP.** Application services submit AuthZEN requests instead of embedding authorization rules in business code.
- **Reduce RBAC/ABAC sprawl.** Teams review and version central Rego policies rather than maintaining divergent checks in each microservice.
- **Hot policy activation.** The OPA SDK observes changed ETag-versioned bundles without a process restart, avoiding a PDP restart during policy updates.
- **Durable auditability.** The Durable Object stores authorization and policy-activation events with the related request and decision. The current demo is append-oriented, but does not cryptographically prevent storage edits; tamper-evident hash chaining and immutable export are production hardening items, not current guarantees.
- **Self-validating policy authoring.** AI-generated policies are validated by Go OPA, repaired and revalidated when invalid, then presented for human review before activation.

## Scalability architecture

- **Workers:** Stateless request handling can scale across Cloudflare's 300+ global network locations. Isolates have low startup overhead; this is not a guarantee of zero cold starts or latency.
- **Durable Objects:** A workspace actor serializes access to its SQLite state without distributed locks. Tenant/workspace sharding is required to avoid hot actors as load grows.
- **Workflows:** Durable multi-step execution tracks progress and retries generation, validation, repair, and persistence independently of the initiating HTTP request.
- **Go OPA PDP:** Evaluation is stateless and OPA polls bundles with conditional ETag requests. The current in-process bundle authority is single-instance; horizontally consistent Go replicas need a shared bundle origin or coordinated synchronization.
- **Native Containers:** The Durable Object can start the configured OPA container on demand and use its local TCP port; local Compose instead uses service discovery over the bridge network.

## Future roadmap and security hardening

- **Identity:** Verify OIDC/JWT credentials at the Worker PEP with `jose` or Cloudflare Access and map verified claims into AuthZEN subject properties. Never trust roles supplied by an unauthenticated browser.
- **Concurrency and distribution:** Shard Durable Objects by tenant/workspace, use optimistic `version` compare-and-swap for approvals, and distribute signed bundles through Cloudflare R2 and a CDN.
- **Audit integrity:** Add a hash chain and immutable/object-lock export before making tamper-evidence claims.
- **Dependency and policy security:** [renovate.json](./renovate.json) configures weekly grouped dependency updates and vulnerability alerts for Go, npm, and Docker images. Add `govulncheck`, `npm audit` CI gates, Regal Rego linting, and rate limits/authorization on AI workflow triggers.

## Quickstart

### A. Start the full local stack

Docker Compose builds and starts OPA, Wrangler Worker/Durable Objects/Workflows, and the Vite frontend on the shared `authzen-net` bridge:

```sh
docker compose up --build
```

Open `http://127.0.0.1:5173`. To use denial explanations and policy authoring, set `CLOUDFLARE_API_TOKEN` in the shell or a local secret manager before starting Compose; the token must be authorized for Workers AI and should never be committed. OPA health gates Worker startup. The frontend proxies API routes to `http://worker:8787` inside the Compose network.

The Worker image uses a Compose-specific Wrangler config without the native Containers binding so it selects the HTTP PDP adapter. The root production [wrangler.jsonc](./wrangler.jsonc) includes the Containers binding and points it at `opa-service/Dockerfile`.

### B. Run the Playwright E2E suite

The suite starts isolated local Go, Worker, and Vite services itself; stop Compose first to free the ports. It requires the Workers AI token for the real explanation and authoring scenarios.

```sh
cd e2e
npm install
npx playwright install chromium
npx playwright test
```

To run against an already-running Compose stack instead, set `E2E_BASE_URL=http://127.0.0.1:5173`; that suppresses Playwright's service startup. The five scenarios cover AuthZEN discovery/health, allow and audit persistence, deny and AI explanation, AI workflow validation/approval/hot bundle sync, and persistence across a browser reload.

### C. Deploy to Cloudflare

After `npx wrangler login`, configure the Pages project name and the public Go OPA URL if deploying the Worker without native Containers. Build and deploy the Worker (including its configured OPA Container image) and Pages assets:

```sh
npm --prefix frontend run build && \
npx wrangler deploy --config wrangler.jsonc --var OPA_SERVICE_URL:https://<public-go-pdp-host> && \
npx wrangler pages deploy frontend/dist --project-name <pages-project-name>
```

For native Containers, the Durable Object selects the configured OPA image; the public HTTP URL remains the fallback for runtimes without a container. Complete identity verification, audit integrity, workflow rate limits, secrets, and bundle-distribution hardening before production use.

## Container image targets

Compose builds all images using the repository root context so [.dockerignore](./.dockerignore) applies consistently. The frontend Dockerfile has a `development` stage for Compose and a `production` Nginx stage:

```sh
docker build -f frontend/Dockerfile --target production -t policy-control-plane .
docker build -f opa-service/Dockerfile -t policy-opa .
```

The OPA build uses `golang:1.24-alpine` and selects Go 1.26.0 because the current OPA module requires it; the runtime is `alpine:3.20` and includes an HTTP health check.
