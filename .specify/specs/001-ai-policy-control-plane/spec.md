# Feature Specification: AI-Assisted Policy-as-Code Control Plane

## User Scenarios
1. **Protected Resource Enforcement (PEP -> PDP)**: A user selects a mock persona (`alice` viewer, `bob` editor, `carol` admin) in the SPA and triggers protected actions (`read_report`, `publish_report`, `delete_workspace`). The Cloudflare Worker PEP calls the Durable Object, which queries the Go OPA singleton (`/evaluate`), logs the decision to SQLite, and returns `200 ALLOW` or `403 DENY` with reasons.
2. **AI Policy Authoring with Self-Correction**: A user describes an access rule in plain English in the chat panel. `PolicyAuthoringWorkflow` prompts Llama 3.3 to generate Rego v1, validates it against Go OPA (`/validate`), automatically repairs any compiler errors via a retry step, and presents a diff for approval.
3. **Hot-Reload Local Bundle Sync**: Approving a policy persists a new version in Durable Object SQLite and calls Go OPA `POST /policies/sync`, which updates the local mock bundle tarball revision and triggers an immediate bundle reload in the `sdk.OPA` singleton.
