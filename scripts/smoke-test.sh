#!/usr/bin/env bash
set -euo pipefail

OPA_URL="${OPA_URL:-http://127.0.0.1:8080}"
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8787}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

check_decision() {
  local url="$1"
  local request_file="$2"
  local expected="$3"
  local response_file="$4"
  local status="000"
  for attempt in $(seq 1 20); do
    status="$(curl --silent --max-time 5 -o "$response_file" -w '%{http_code}' \
      -H 'Content-Type: application/json' --data-binary "@$request_file" "$url" || true)"
    if [[ "$status" == "200" ]]; then
      python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["decision"] is (sys.argv[2] == "true") else 1)' \
        "$response_file" "$expected" ||
        fail "$url returned an unexpected decision: $(cat "$response_file")"
      return
    fi
    [[ "$attempt" -lt 20 ]] || fail "$url returned HTTP $status: $(cat "$response_file")"
    sleep 1
  done
}

check_worker_decision() {
  local request_file="$1"
  local expected_status="$2"
  local expected_decision="$3"
  local response_file="$4"
  local status
  status="$(curl --silent --show-error --max-time 10 -o "$response_file" -w '%{http_code}' \
    -H 'Content-Type: application/json' --data-binary "@$request_file" \
    "$WORKER_URL/api/pep/enforce")" || fail "Worker PEP request failed"
  [[ "$status" == "$expected_status" ]] ||
    fail "Worker PEP returned HTTP $status, expected $expected_status: $(cat "$response_file")"
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["decision"] is (sys.argv[2] == "true") else 1)' \
    "$response_file" "$expected_decision" ||
    fail "Worker PEP returned an unexpected decision: $(cat "$response_file")"
}

check_audit_entry() {
  local state_file="$1"
  local subject_id="$2"
  local expected_decision="$3"
  python3 - "$state_file" "$subject_id" "$expected_decision" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as state_file:
    state = json.load(state_file)
expected = sys.argv[3] == "true"
found = any(
    entry.get("eventType") == "authorization"
    and (entry.get("request") or {}).get("action", {}).get("name") == "delete_workspace"
    and (entry.get("request") or {}).get("subject", {}).get("id") == sys.argv[2]
    and (entry.get("response") or {}).get("decision") is expected
    for entry in state.get("auditLogs", [])
)
sys.exit(0 if found else 1)
PY
}

read_etag() {
  awk 'tolower($1) == "etag:" { sub(/\r$/, "", $2); print $2 }' "$1"
}

for attempt in $(seq 1 30); do
  if curl --silent --max-time 2 --output /dev/null "$OPA_URL/health"; then
    break
  fi
  [[ "$attempt" -lt 30 ]] || fail "Go OPA health endpoint is unavailable at $OPA_URL"
  sleep 1
done

curl --silent --show-error --fail --max-time 10 "$OPA_URL/health" >"$TEMP_DIR/health.json" ||
  fail "Go OPA health check failed"
python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["status"] == "ok" else 1)' \
  "$TEMP_DIR/health.json" ||
  fail "Go OPA health endpoint returned an unexpected response"
curl --silent --show-error --fail --max-time 10 \
  "$OPA_URL/.well-known/authzen-configuration" >"$TEMP_DIR/discovery.json" ||
  fail "OpenID AuthZEN discovery request failed"
python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("access_evaluation_endpoint") else 1)' \
  "$TEMP_DIR/discovery.json" ||
  fail "OpenID AuthZEN discovery response is missing its evaluation endpoint"

curl --silent --show-error --fail --max-time 10 -D "$TEMP_DIR/bundle.headers" \
  -o "$TEMP_DIR/bundle.tar.gz" "$OPA_URL/bundle-server/bundles/bundle.tar.gz" ||
  fail "local OPA bundle download failed"
[[ -s "$TEMP_DIR/bundle.tar.gz" ]] || fail "OPA bundle tarball is empty"
INITIAL_ETAG="$(read_etag "$TEMP_DIR/bundle.headers")"
[[ -n "$INITIAL_ETAG" ]] || fail "OPA bundle response did not include an ETag"

cat >"$TEMP_DIR/admin-request.json" <<'JSON'
{
  "subject": {"type":"user","id":"carol","properties":{"role":"admin","roles":["admin"]}},
  "resource": {"type":"workspace","id":"workspace-prod","properties":{"owner":"carol"}},
  "action": {"name":"delete_workspace"},
  "context": {"authenticated":true}
}
JSON
cat >"$TEMP_DIR/viewer-request.json" <<'JSON'
{
  "subject": {"type":"user","id":"alice","properties":{"role":"viewer","roles":["viewer"]}},
  "resource": {"type":"workspace","id":"workspace-prod","properties":{"owner":"carol"}},
  "action": {"name":"delete_workspace"},
  "context": {"authenticated":true}
}
JSON

check_decision "$OPA_URL/access/v1/evaluation" "$TEMP_DIR/admin-request.json" true \
  "$TEMP_DIR/admin-response.json"
check_decision "$OPA_URL/access/v1/evaluation" "$TEMP_DIR/viewer-request.json" false \
  "$TEMP_DIR/viewer-response.json"

check_worker_decision "$TEMP_DIR/admin-request.json" 200 true "$TEMP_DIR/worker-allow.json"
check_worker_decision "$TEMP_DIR/viewer-request.json" 403 false "$TEMP_DIR/worker-deny.json"
curl --silent --show-error --fail --max-time 10 "$WORKER_URL/api/state" >"$TEMP_DIR/state.json" ||
  fail "Worker control-plane state request failed"
check_audit_entry "$TEMP_DIR/state.json" carol true ||
  fail "SQLite audit log is missing the Worker allow event"
check_audit_entry "$TEMP_DIR/state.json" alice false ||
  fail "SQLite audit log is missing the Worker deny event"

python3 - "$ROOT_DIR/opa-service/policies/authz.rego" "$TEMP_DIR/sync-request.json" <<'PY'
import json
import pathlib
import sys

data = {
    "roles": {
        "admin": ["read", "write", "delete", "read_report", "publish_report", "delete_workspace"],
        "editor": ["read_report", "publish_report"],
        "viewer": ["read", "read_report", "delete_workspace"],
    }
}
payload = {"rego": pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), "data": data}
with open(sys.argv[2], "w", encoding="utf-8") as request_file:
    json.dump(payload, request_file)
PY
SYNC_STATUS="$(curl --silent --show-error --max-time 10 -o "$TEMP_DIR/sync-response.json" \
  -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "@$TEMP_DIR/sync-request.json" "$OPA_URL/policies/sync")" ||
  fail "policy sync request failed"
[[ "$SYNC_STATUS" == "200" ]] ||
  fail "policy sync returned HTTP $SYNC_STATUS: $(cat "$TEMP_DIR/sync-response.json")"
SYNC_REVISION="$(python3 - "$TEMP_DIR/sync-response.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response_file:
    response = json.load(response_file)
if response.get("synced") is not True or not response.get("revision"):
    sys.exit("policy sync response is invalid")
print(response["revision"])
PY
)" || fail "policy sync response is invalid"

curl --silent --show-error --fail --max-time 10 -D "$TEMP_DIR/updated-bundle.headers" \
  -o "$TEMP_DIR/updated-bundle.tar.gz" "$OPA_URL/bundle-server/bundles/bundle.tar.gz" ||
  fail "updated OPA bundle download failed"
UPDATED_ETAG="$(read_etag "$TEMP_DIR/updated-bundle.headers")"
[[ -n "$UPDATED_ETAG" && "$UPDATED_ETAG" != "$INITIAL_ETAG" ]] ||
  fail "policy sync did not change the bundle ETag"
[[ "$UPDATED_ETAG" == "\"$SYNC_REVISION\"" ]] ||
  fail "bundle ETag $UPDATED_ETAG does not match sync revision $SYNC_REVISION"

for attempt in $(seq 1 20); do
  status="$(curl --silent --max-time 5 -o "$TEMP_DIR/reloaded-response.json" -w '%{http_code}' \
    -H 'Content-Type: application/json' --data-binary "@$TEMP_DIR/viewer-request.json" \
    "$OPA_URL/access/v1/evaluation" || true)"
  if [[ "$status" == "200" ]] &&
    python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["decision"] is True else 1)' \
      "$TEMP_DIR/reloaded-response.json" >/dev/null 2>&1; then
    break
  fi
  [[ "$attempt" -lt 20 ]] || fail "OPA did not apply the synced policy within 20 seconds"
  sleep 1
done

printf 'PASS: Go OPA, AuthZEN, bundle ETag, Worker PEP/audit, and policy hot-reload checks\n'
