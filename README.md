# AI-Assisted Policy-as-Code Control Plane (`cf_ai_policy_as_code`)

**Live demo:** `<ADD_CLOUDFLARE_PAGES_URL>`

An AI-assisted authorization control plane that drafts, validates, reviews, and activates Rego v1 policies. Cloudflare provides the user-facing PEP, durable state, and workflow/LLM orchestration; a constructor-DI Go service embeds the OPA SDK as the policy decision point (PDP).

## Architecture

```text
  +--------------------------+
  | Cloudflare Pages         |
  | React 19 control-plane   |
  +------------+-------------+
               | AuthZEN / control API
               v
  +------------+-------------+       state, audit, candidates, chat
  | Cloudflare Worker        |------------------------------------+
  | PEP + AuthZEN API + DI   |                                    |
  +---+------------------+---+                                    v
      |                  |                           +--------------------------+
      | PEP evaluation   | author-policy             | Durable Object           |
      |                  v                           | SQLite state             |
      |         +-----------------------+             +--------------------------+
      |         | Cloudflare Workflow   |                         ^
      |         | generate/validate/    |                         |
      |         | repair/persist        |                         |
      |         +-----+------------+----+                         |
      |               |            |                              |
      |               v            |                              |
      |      +------------------+  |                              |
      |      | Workers AI       |  |                              |
      |      | Llama 3.3        |  |                              |
      |      +------------------+  |                              |
      |                            | OPA validate/sync             |
      +----------------------------+------------------------------+
                                   v
                  +------------------------------------+
                  | DI-wired Go PDP (`opa/v1/sdk`)     |
                  | OpenID AuthZEN evaluation/discovery|
                  |                                    |
                  | embedded OPA SDK <-> in-process    |
                  | tar.gz bundle server + ETag        |
                  +------------------------------------+
```

The Worker exposes OpenID AuthZEN Authorization API 1.0 evaluation and discovery endpoints and a PEP endpoint. PEP allow responses use HTTP `200`; denials use HTTP `403`. Candidate policies are validated by Go OPA before approval and synchronization to the bundle server. OPA picks up changed bundle revisions through its configured polling.

## Cloudflare assignment components

| Required component | Implementation |
| --- | --- |
| LLM | Cloudflare Workers AI using `@cf/meta/llama-3.3-70b-instruct-fp8-fast` to generate Rego v1, repair compiler failures, and explain denials. |
| Workflow / Coordination | Cloudflare Workflows coordinate policy retrieval, generation, Go OPA validation, bounded repair, and candidate persistence. |
| User Input | The React control-plane SPA provides AuthZEN PEP simulation, policy authoring chat, candidate review, and approval. |
| Memory / State | A SQLite-backed Durable Object stores active policy versions, candidates, authorization audit events, chat history, and workflow progress. |

## Repository layout

- [`opa-service/`](./opa-service/) — Go HTTP PDP using embedded `github.com/open-policy-agent/opa/v1/sdk`, Rego validation, and an in-process ETag bundle server.
- [`worker/`](./worker/) — Cloudflare Worker routes, PEP, Durable Object, Workflows, and Workers AI adapters.
- [`frontend/`](./frontend/) — React 19 + Vite control-plane SPA for Cloudflare Pages.
- [`wrangler.jsonc`](./wrangler.jsonc) — Worker, Durable Object, SQLite migration, AI, and Workflow bindings.
- [`scripts/smoke-test.sh`](./scripts/smoke-test.sh) — Local end-to-end checks for the Go PDP and Worker.
- [`PROMPTS.md`](./PROMPTS.md) — Prompt traceability for the implementation.

## Local development

Requirements: Go 1.24+, Node.js/npm, `curl`, and Python 3. Install each JavaScript package set once:

```sh
npm install --prefix worker
npm install --prefix frontend
```

Start these three processes in separate terminals from the repository root.

**Terminal 1 — Go OPA PDP and bundle server**

```sh
cd opa-service
go run ./cmd/server
```

**Terminal 2 — Cloudflare Worker, Durable Object, and Workflow**

```sh
cd worker
npx wrangler dev --config ../wrangler.jsonc --ip 127.0.0.1 --port 8787
```

**Terminal 3 — React control plane**

```sh
cd frontend
npm run dev -- --host 127.0.0.1
```

Open the Vite URL printed in Terminal 3. Its development proxy forwards `/api`, `/access`, and `/.well-known` requests to the local Worker on port `8787`.

With the Go service and Worker running, execute the end-to-end checks from the repository root:

```sh
./scripts/smoke-test.sh
```

The smoke test verifies health and AuthZEN discovery, the bundle tarball and ETag, admin/viewer decisions, Worker PEP status codes and SQLite audit persistence, then syncs a test policy and checks that OPA reloads its new revision.

## Cloudflare deployment

1. Configure the production `OPA_SERVICE_URL` to an HTTPS Go PDP URL reachable from Cloudflare Workers. The local `http://127.0.0.1:8080` value in `wrangler.jsonc` is for development only; localhost in a deployed Worker refers to the Worker runtime, not your PDP.
2. Build the Pages assets:

   ```sh
   cd frontend
   npm run build
   cd ..
   ```

3. Authenticate Wrangler with `npx wrangler login`, then deploy the Worker and Pages site. Replace the sample values with your Worker and Pages project names/URLs:

   ```sh
   npx wrangler deploy --config wrangler.jsonc \
     --var OPA_SERVICE_URL:https://<public-go-pdp-host>
   npx wrangler pages deploy frontend/dist --project-name <pages-project-name>
   ```

   If Wrangler is installed only under `worker/`, invoke the same Wrangler commands through `worker/node_modules/.bin/wrangler` from the repository root.

4. Set the Pages site URL as the Worker frontend origin if your deployment requires a restricted CORS allowlist. Confirm the production Worker can reach the Go PDP’s AuthZEN, validation, and policy-sync endpoints.

The Go PDP must be deployed separately to a network location accessible to the Worker, and its advertised discovery endpoint should use its public HTTPS URL (configure `PDP_PUBLIC_URL` accordingly).
