# 002-cf-pep-workflow

- **Status**: Draft
- **Parent Epic**: [EPIC-01](../../epics/EPIC-01-policy-control-plane.md)
- **Parent Topic**: [TOPIC-02](../../topics/TOPIC-02-cf-pep-workflow.md)

## Goal

Provide the Cloudflare Edge Policy Enforcement Point (PEP), persistent policy and audit state, and a self-correcting policy authoring workflow.

## Acceptance Criteria

1. A Worker receives OpenID AuthZEN Authorization API 1.0 evaluation requests and delegates the decision to the Go OPA PDP using `POST /access/v1/evaluation`.
2. The `PolicyEngineDO` Durable Object stores policy versions, audit logs, and chat history in SQLite.
3. All SQLite statements use `this.ctx.storage.sql.exec(...)` with parameter binding.
4. The Cloudflare Workflow performs generation, OPA `/validate`, and auto-repair as separate bounded steps.
5. Policy generation and denial explanations use `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
6. Generated Rego must start with `package authz` and `import rego.v1` and pass `/validate` before activation.
7. A `403` decision includes reasons and an AI-generated explanation where the LLM is available.
8. Policy synchronization updates the OPA PDP and creates a versioned SQLite audit record.
9. Worker configuration exposes `AI`, `POLICY_DO`, and `POLICY_WORKFLOW` bindings in `wrangler.jsonc`.

## API Contracts

### POST /api/evaluate

- Request: AuthZEN `AccessEvaluationRequest` shape: `{"subject":{"type":"user","id":"alice","properties":{}},"resource":{"type":"document","id":"doc-1","properties":{}},"action":{"name":"read","properties":{}},"context":{}}`
- The Worker maps this request to the PDP's `POST /access/v1/evaluation` and retains AuthZEN's `{"decision":boolean,"context":{"reasons":["string"],"policy_version":"string"}}` contract in its response, adding an optional denial `explanation` in response context.
- HTTP result: `200 OK` with `decision: true` or `403 Forbidden` with `decision: false`; malformed request and upstream failures return explicit error responses, not decision-shaped success responses.

### PDP discovery contract used by Worker

- Request: `GET /.well-known/authzen-configuration`
- Response: `{"policy_decision_point":"https://pdp.example","access_evaluation_endpoint":"https://pdp.example/access/v1/evaluation"}`

### POST /api/policies/sync

- Request: `{"rego":"string","data":{...}}`
- Success: `200 {"revision":"string","synced":true}`

### POST /api/policies/generate

- Request: `{"prompt":"string","currentRego":"string?"}`
- Success: `202 {"workflowId":"string","status":"started"}`

## Persistence Contracts

- Policy versions include id, Rego text, data JSON, revision, and timestamps.
- Audit logs include decision or workflow event, input, result, revision, and timestamps.
- Chat history includes role, message, workflow id, and timestamps.
