# TOPIC-01: DI-Wired Embedded Go OPA PDP & OpenID AuthZEN 1.0 Server
- **Parent Epic**: `EPIC-01`
- **Scope**: Onion-layered Go service (`opa-service/`) wired via `internal/di/container.go` (no globals), loading external `config/opa-config.yaml`, serving an in-memory `.tar.gz` Rego v1 bundle with ETag revisions, and exposing OpenID AuthZEN 1.0 (`POST /access/v1/evaluation`, `GET /.well-known/authzen-configuration`) plus `/validate` and `/policies/sync`.
