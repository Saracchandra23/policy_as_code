# Tasks: 001-go-opa-singleton

## [Domain]

- [x] Define policy, revision, evaluation, and bundle snapshot domain types in `opa-service/internal/domain`.
- [x] Define `ErrInvalidRego` and `ErrEngineNotReady` sentinel errors.
- [x] Define AuthZEN `AccessEvaluationRequest`, `AccessEvaluationResponse`, subject/resource/action/context, and discovery metadata domain types.
- [x] Add domain unit tests for sentinel errors and evaluation values; extend coverage for AuthZEN request/response semantics.

## [Application]

- [x] Define outbound `PolicyDecisionPort` and `BundleServerPort` interfaces.
- [x] Define AuthZEN evaluation through the decision port and PDP discovery through an injected configuration use case.
- [x] Implement sync, validate, and evaluate use cases using only domain types and application ports.
- [x] Add unit tests for sync, validate, and evaluate use cases with fake outbound ports; add AuthZEN and discovery use-case tests.

## [Infrastructure]

- [x] Add external `opa-service/config/opa-config.yaml` configuration via `OPA_CONFIG_PATH`.
- [x] Add seed `opa-service/policies/authz.rego` and `opa-service/policies/data.json`.
- [x] Implement thread-safe bundle memory with `sync.RWMutex`, atomic policy/data replacement, dynamic tar+gzip bundle, and revision ETag.
- [x] Refactor OPA adapter to `OPAEngineAdapter` constructed with an injected `*sdk.OPA`; eliminate package-level singleton variables and service accessors.
- [x] Load YAML from `OPA_CONFIG_PATH` (default `./config/opa-config.yaml`).
- [x] Implement AuthZEN request-to-OPA mapping and PDP discovery metadata using configured public base URL.
- [x] Add infrastructure tests for AuthZEN mapping, bundle contents, and ETag revisions.

## [Delivery]

- [x] Implement `POST /access/v1/evaluation` with the AuthZEN 1.0 request and response DTOs.
- [x] Implement `GET /.well-known/authzen-configuration` with `policy_decision_point` and `access_evaluation_endpoint`.
- [x] Implement typed policy DTOs and `POST /policies/sync` and `POST /validate`.
- [x] Implement `GET /bundle-server/bundles/bundle.tar.gz` with `Content-Type`, body, and quoted `ETag`.
- [x] Add HTTP handler tests for AuthZEN success/deny responses, discovery metadata, invalid payloads, and service errors.

## [DI Composition Root]

- [x] Add `opa-service/internal/di/container.go` with constructor-based graph creation, injected configuration, and returned handler; no package-level state.
- [x] Construct one OPA SDK engine per container lifetime; no package-level singleton or service locator is used.
- [x] Update `opa-service/cmd/server/main.go` to call `di.NewContainer(...)` and serve only the returned handler.
- [x] Verify `sdk.New` occurs only in the container construction path and no global singleton or service locator remains.
