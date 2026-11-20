---
name: opa-rego-verify
description: Verify Rego v1 headers, Onion import boundaries, constructor DI (no global singletons), and Go build/tests.
---
# OPA, DI & Onion Verification Skill

1. Verify all `.rego` files start with `package authz` and `import rego.v1` and inspect `input.subject`, `input.action`, `input.resource`.
2. Verify `opa-service/internal/domain` has zero third-party imports.
3. Verify no package-level `sync.Once` or `GetInstance` globals exist (`grep -rn "GetInstance" opa-service/` returns empty) and all wiring lives in `opa-service/internal/di/container.go`.
4. Run `cd opa-service && go mod tidy && go vet ./... && go test ./...`.
