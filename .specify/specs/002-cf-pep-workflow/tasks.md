# Tasks: 002-cf-pep-workflow

## [Domain]

- [x] Define OpenID AuthZEN `AccessEvaluationRequest`, `AccessEvaluationResponse`, `AuthZenConfiguration`, and typed subject/resource/action/context models.
- [x] Define policy version, candidate, audit entry, chat message, validation, and control-plane state entities.
- [ ] Define typed domain errors and Rego generation/repair workflow state types.
- [ ] Add domain tests for AuthZEN decision mapping and workflow state transitions.

## [Application]

- [x] Define `AuthZenPDPPort`, `PolicyStoragePort`, and `CopilotLLMPort`.
- [x] Implement evaluation/audit, validated policy approval/sync, denial explanation, and control-plane state use cases.
- [x] Implement durable generate -> validate -> repair orchestration and gate candidate approval in the application use case.
- [x] Ensure policy activation is gated by successful OPA `/validate` and Rego v1 headers.
- [ ] Add application unit tests using fake PDP, storage, and LLM ports.

## [Infrastructure]

- [x] Implement AuthZEN HTTP client `POST /access/v1/evaluation` with typed request/response DTOs.
- [x] Implement PDP discovery client for `GET /.well-known/authzen-configuration`.
- [x] Implement Workers AI generation and denial explanation with the Llama 3.3 model binding.
- [x] Implement Durable Object SQLite initialization and parameterized policy, audit, chat, and workflow-progress queries.
- [x] Configure `AI`, `POLICY_DO`, and `POLICY_WORKFLOW` in `wrangler.jsonc`.
- [ ] Add adapter tests for AuthZEN payloads, errors, SQLite parameterization, and workflow repair interactions.

## [Delivery]

- [x] Implement Worker PEP routes accepting AuthZEN evaluation requests and returning decision/context semantics.
- [x] Implement explicit malformed request and PDP failure responses without allow-shaped fallbacks.
- [x] Implement `PolicyEngineDO` request handling and policy/audit/chat persistence transport.
- [x] Implement `PolicyAuthoringWorkflow` generation, validation, repair, candidate persistence, and durable live-step reporting.
- [ ] Add delivery tests for decision allow/deny status, discovery errors, and workflow failure behavior.

## [DI Composition Root]

- [x] Add `worker/src/di/container.ts` with `createContainer(env, sql)` that constructs and injects adapters and use cases, plus runtime-specific gateway and workflow factories.
- [x] Wire the Worker router, Durable Object, and Workflow to their constructor-built DI graphs.
- [x] Ensure no module-level service globals, service locator, or mutable dependency cache exists.
- [x] Verify the container uses only passed bindings/storage and can be created independently for isolated contexts.
