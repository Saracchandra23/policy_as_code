# Tasks: 003-control-plane-spa

## [Domain]

- [x] Define typed AuthZEN subject, resource, action, context, `AccessEvaluationRequest`, and `AccessEvaluationResponse` models.
- [x] Define policy version, candidate, line-diff, and approval response types.
- [x] Define audit entry, chat, and Copilot workflow update types.
- [ ] Add domain tests for decision rendering and authorization state distinctions.

## [Application]

- [x] Define `PolicyApiPort`, `AuditStreamPort`, and `CopilotPort` interfaces using typed AuthZEN DTOs.
- [x] Implement evaluation, policy approval, audit refresh, and Copilot workflow controllers.
- [x] Render explicit loading, allow, deny, candidate-validation, and workflow failure states.
- [ ] Add controller tests for allow, deny, and transport-error cases.

## [Infrastructure]

- [x] Implement a strict typed API client for AuthZEN evaluation and Worker policy/audit/Copilot contracts.
- [x] Implement PDP discovery by reading `GET /.well-known/authzen-configuration`.
- [x] Implement audit polling and Copilot workflow status polling.
- [x] Keep HTTP status and API error handling in adapters, not presentation components.
- [ ] Add API client tests for AuthZEN request/response DTO compatibility and errors.

## [Delivery]

- [x] Build the persona/action/resource simulator using AuthZEN request fields.
- [x] Build loading, `200 ALLOW`, `403 DENY`, and transport failure result views.
- [x] Build the active/candidate Rego viewer and line-by-line diff approval flow.
- [x] Build the audit log viewer and progressively updating AI Copilot chat.
- [x] Prevent policy activation unless diff approval, validation, and sync succeed.
- [x] Configure Vite and Cloudflare Pages deployment output.
- [ ] Add focused UI tests for AuthZEN decision states, diff approval, and validation failure.

## [DI Composition Root]

- [x] Construct frontend API adapters and application controllers through explicit constructors at the SPA entry point.
- [x] Pass dependencies into feature components; do not introduce module-level service globals or a service locator.
- [x] Verify the SPA consumes the Worker PEP contract and does not instantiate server-side Go or Worker containers.
