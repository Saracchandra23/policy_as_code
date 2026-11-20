# 003-control-plane-spa

- **Status**: Draft
- **Parent Epic**: [EPIC-01](../../epics/EPIC-01-policy-control-plane.md)
- **Parent Topic**: [TOPIC-03](../../topics/TOPIC-03-control-plane-spa.md)

## Goal

Provide a React + Vite policy studio for persona/action simulation, live Rego editing, audit inspection, and AI policy assistance.

## Acceptance Criteria

1. The SPA provides persona, action, and resource simulation controls.
2. Authorization results explicitly display loading, `200 ALLOW`, and `403 DENY` states while using the OpenID AuthZEN Authorization API 1.0 request and decision payload.
3. A live Rego v1 editor shows generated or edited policy and a diff against the active policy.
4. Policy changes require diff approval before synchronization.
5. The SPA displays a streaming or progressively updating audit log from the Worker and Durable Object state.
6. The AI Policy Copilot sends prompts and displays generated policy or repair progress.
7. Frontend API DTOs match Worker contracts and use strict TypeScript types.
8. The UI communicates validation and activation failures without partial or false success.
9. The app is deployable as a single-page application on Cloudflare Pages.

## UX Contracts

### OpenID AuthZEN Authorization API 1.0

- The simulator sends an `AccessEvaluationRequest` to the Worker: `{"subject":{"type":"user","id":"alice","properties":{}},"resource":{"type":"document","id":"doc-1","properties":{}},"action":{"name":"read","properties":{}},"context":{}}`.
- The request is forwarded to the PDP's `POST /access/v1/evaluation`.
- The decision payload is `{"decision":true,"context":{"reasons":["string"],"policy_version":"string"}}`; response `context` may be omitted.
- The SPA can discover PDP metadata from `GET /.well-known/authzen-configuration`, which returns `policy_decision_point` and `access_evaluation_endpoint`.

### Authorization Simulator

- Inputs: AuthZEN subject, action, resource, and optional context/properties.
- Loading: render an in-progress state.
- Allow: render `200 ALLOW`, AuthZEN decision, reasons, policy version, and explanation.
- Deny: render `403 DENY`, AuthZEN decision, reasons, policy version, and explanation.

### Rego Studio

- Shows active Rego and proposed Rego in a diff view.
- Rejects activation when validation or bundle sync fails.
- Requires explicit user approval of a proposed diff.

### Audit and Copilot

- Audit entries include event, timestamp, revision, decision or status, and result.
- Copilot chat preserves role and workflow state and displays bounded generation progress.
