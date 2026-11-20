# AI Prompt History

Log major prompts used with VS Code Copilot / Ollama during development (required for Cloudflare assignment submission).

## 1. Repository & Architecture Setup
- Initialized `policy_as_code` monorepo with Go OPA SDK backend, Cloudflare Worker/Durable Object PEP, and React Pages frontend.

## 2. Spec-Kit Feature Artifacts
- Prompt: `/speckit-workflow` Read `.specify/memory/constitution.md`, `.specify/epics/EPIC-01-policy-control-plane.md`, and all three `.specify/topics/` files. Generate `spec.md`, `plan.md`, and `tasks.md` inside `.specify/specs/001-go-opa-singleton/`, `.specify/specs/002-cf-pep-workflow/`, and `.specify/specs/003-control-plane-spa/`. Ensure every plan contains a Constitution Check and Onion Architecture contracts, every task list follows `[Domain] -> [Application] -> [Infrastructure] -> [Delivery]`, and update `PROMPTS.md`.
- Created behavioral specs, implementation plans, Constitution Checks, explicit folder and interface contracts, and inward-ordered task lists for the Go OPA singleton, Cloudflare PEP/workflow, and React control-plane SPA features.

## 3. Go OPA Singleton and Bundle Service
- Prompt: Update `.specify/specs/001-go-opa-singleton/tasks.md` in strict Onion order, including external OPA YAML configuration, seed Rego and data files, an in-process tar/gzip bundle server with ETag support, domain and use-case unit tests, and `/opa-rego-verify`.
- Implemented the Go OPA service in Onion layers with external YAML configuration, seed Rego/data, a thread-safe bundle store, DI-managed OPA SDK lifecycle, HTTP delivery routes on port `8080`, and focused domain/application/infrastructure/HTTP tests.

## 4. AuthZEN API and Constructor-Based DI Specs
- Prompt: `/speckit-workflow` Read the constitution, parent epic, and all three topics; update all three feature specs/plans/tasks for zero-global constructor-based DI containers (`opa-service/internal/di/container.go`, `worker/src/di/container.ts`), OpenID AuthZEN Authorization API 1.0 evaluation/discovery contracts, five-phase task ordering, and prompt traceability.
- Updated all feature specs, plans, and tasks with AuthZEN request/response and discovery contracts, no-global constructor-based DI container responsibilities, Onion folder/interface contracts, and `[Domain] -> [Application] -> [Infrastructure] -> [Delivery] -> [DI Composition Root]` ordering.

## 5. Go OPA AuthZEN PDP Implementation
- Prompt: Implement `.specify/specs/001-go-opa-singleton/tasks.md` in `/opa-service` using strict Onion Architecture and constructor Dependency Injection wired in `internal/di/container.go` (zero package-level globals). Expose OpenID AuthZEN 1.0 `POST /access/v1/evaluation` and `GET /.well-known/authzen-configuration`, plus `POST /validate`, `POST /policies/sync`, and the in-process `/bundle-server/bundles/bundle.tar.gz` ETag tarball server backed by external `config/opa-config.yaml` and Rego v1 policies evaluating `input.subject`, `input.action`, `input.resource`, and `input.context`. Run `/opa-rego-verify` and update `PROMPTS.md`.
- Implemented the container-owned OPA SDK lifecycle, typed AuthZEN domain/application/delivery contracts, Rego v1 policy, bundle repository/ETags, external config loading, and focused unit/integration tests. Verified the live endpoints and ran the OPA module tidy, vet, tests, Rego header/input, domain-import, and zero-global checks.

## 6. Cloudflare Worker PEP and Policy Workflow
- Prompt: Implement Topic 02 in `/worker` using strict Onion Architecture and constructor DI, configure root `wrangler.jsonc`, expose AuthZEN evaluation/discovery and PEP/control-plane routes, persist policy/audit/chat state in Durable Object SQLite, and add the Workers AI Rego generation -> OPA validation -> auto-repair Workflow. Generate Wrangler types, typecheck, check completed tasks, and update `PROMPTS.md`.
- Implemented the Worker domain, ports/use cases, SQLite/OPA/Workers AI adapters, DI factories, Durable Object, Workflow, and CORS routes. Wrangler type generation and TypeScript typechecking passed; generated types and completed Topic 02 tasks were recorded. A Wrangler deploy dry-run could not read dependencies through the Windows/WSL mapped path.

## 7. React Policy Control Plane SPA
- Prompt: Read the Topic 03 constitution/spec/plan/tasks and implement the React 19 + Vite control plane with strict AuthZEN DTOs, PEP simulation, policy diff approval, audit/chat views, workflow polling, responsive styling, build verification, task updates, and prompt traceability.
- Implemented the typed API adapter, application ports/controller and DI composition, three-panel SPA, and Vite Pages build. Added durable Worker workflow-step progress to support truthful live stage display. Frontend production build and Worker TypeScript verification passed.

## 8. Assignment Submission Finalization
- Prompt: Finalize the Cloudflare assignment by adding an executable end-to-end smoke test for Go OPA health, AuthZEN, tarball ETags, Worker PEP/audit persistence, and policy hot reload; audit constructor DI and Rego v1 conventions; clean prompt traceability; and document the architecture, assignment-component mapping, three-terminal local startup, and Cloudflare deployment.
- Added `/health`, extended seed policy coverage for report/workspace actions, added focused Go health and OPA decision tests, and documented the implementation. The standalone shell smoke script from this iteration was subsequently removed in favor of Playwright E2E coverage.

## 9. Playwright, Dependency Governance, and Submission Documentation
- Prompt: Finalize `cf_ai_policy_as_code` for Cloudflare fast-track submission without a `smoke-test.sh`: implement five Playwright E2E scenarios for AuthZEN discovery/health, PEP allow and deny with AI denial explanation, AI policy workflow validation/approval/hot bundle sync, and Durable Object state persistence; add weekly Renovate dependency and vulnerability management; add a production Go OPA Dockerfile; and document architecture, business use cases, scalability, production hardening, local testing, and deployment.
- Added a service-managed Playwright suite with isolated Durable Object persistence, Renovate rules for Go/Worker/frontend/E2E packages, and a multi-stage OPA container. Replaced the submission README with architecture, operational limits, enterprise use cases, roadmap, and run/deploy instructions.

## 10. Docker Compose and Cloudflare Containers
- Prompt: Finalize the repository with root-context Docker Compose orchestration for OPA, the Wrangler Worker, and Vite; native Cloudflare Container support through a Durable Object PDP adapter with HTTP fallback; configurable Playwright E2E base URL; Renovate grouping including Docker images; and a submission-ready README with local and Cloudflare quickstarts.
- Added three Docker image targets, a shared Compose network and persistent local Worker state, a Compose-specific Wrangler config, and the optional Container-backed PDP adapter. Routed AuthZEN, Workflow validation, and policy activation through the Durable Object PDP port; extended E2E service selection and updated architecture/quickstart documentation.

## 11. Live Deployment Documentation and PDP Discovery Fixes
- Prompt: Finalize the submission with a Playwright E2E suite, weekly Renovate dependency and Docker image updates, Docker Compose local orchestration, native Cloudflare Container support, and a production deployment guide.
- Prompt: Diagnose and fix the PDP discovery `Illegal invocation` and HTML response/JSON parsing failures in the deployed Worker and UI.
- Prompt: Update `README.md` with the live Cloudflare Pages and Worker URLs, all Worker/AuthZEN and Go OPA endpoints, and update `PROMPTS.md` with the session prompts while preserving chronological history.
- Bound the Worker HTTP PDP adapter's fetch function to `globalThis`, changed Worker discovery to advertise its own reachable AuthZEN endpoint rather than proxying upstream PDP metadata, and documented live deployment URLs, endpoint methods, and responsibilities.
