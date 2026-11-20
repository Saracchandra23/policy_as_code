# 001-go-opa-singleton

- **Status**: Draft
- **Parent Epic**: [EPIC-01](../../epics/EPIC-01-policy-control-plane.md)
- **Parent Topic**: [TOPIC-01](../../topics/TOPIC-01-go-opa-singleton.md)

## Goal

Provide the embedded Go OPA Policy Decision Point (PDP) with external configuration, Rego v1 validation and evaluation, policy synchronization, an in-process bundle server, and an OpenID AuthZEN Authorization API 1.0 interface.

## Acceptance Criteria

1. The service initializes one `github.com/open-policy-agent/opa/v1/sdk.OPA` instance per application container using constructor injection; no package-level service globals are used.
2. Configuration is loaded from `OPA_CONFIG_PATH`; the default path is `./config/opa-config.yaml`.
3. `POST /policies/sync` validates and atomically replaces the active Rego and data state, returns the resulting revision, and rejects invalid Rego with `ErrInvalidRego`.
4. `POST /validate` validates Rego v1 policy text without changing the active policy.
5. `POST /access/v1/evaluation` accepts an AuthZEN evaluation request and returns its boolean decision with optional reasons and policy version in response context.
6. `GET /.well-known/authzen-configuration` returns PDP metadata with `policy_decision_point` and an absolute `access_evaluation_endpoint`.
7. `GET /bundle-server/bundles/bundle.tar.gz` serves a dynamically generated tar+gzip bundle containing `.manifest`, `data.json`, and `authz.rego` with an ETag revision header.
8. Bundle state is protected by `sync.RWMutex`, and policy or data replacement is atomic.
9. Every policy and policy example begins with `package authz` and `import rego.v1`, and uses Rego v1 syntax.
10. HTTP transport exposes the service on port `8080` and propagates infrastructure failures as contextual errors.

## API Contracts

### POST /policies/sync

- Request: `{"rego":"string","data":{...}}`
- Success: `{"revision":"string","synced":true}`
- Failure: `{"error":"ErrInvalidRego","message":"string"}`

### POST /validate

- Request: `{"rego":"string"}`
- Success: `{"valid":true}`
- Failure: `{"valid":false,"error":"ErrInvalidRego","message":"string"}`

### POST /access/v1/evaluation

- Request: `{"subject":{"type":"user","id":"alice","properties":{}},"resource":{"type":"document","id":"doc-1","properties":{}},"action":{"name":"read","properties":{}},"context":{}}`
- Success: `{"decision":true,"context":{"reasons":["authorization granted"],"policy_version":"string"}}`
- The response `context` is optional; when present, `reasons` is an array and `policy_version` identifies the evaluated revision.

### GET /.well-known/authzen-configuration

- Success: `{"policy_decision_point":"https://pdp.example","access_evaluation_endpoint":"https://pdp.example/access/v1/evaluation"}`

### GET /bundle-server/bundles/bundle.tar.gz

- Success: `200 OK`, `Content-Type: application/gzip`, `ETag: "<revision>"`, tarball body
- Missing or unavailable bundle: `503 Service Unavailable`
