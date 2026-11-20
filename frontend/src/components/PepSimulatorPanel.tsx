import { useState } from "react";
import type { ControlPlaneController } from "../application/ControlPlaneController";
import type { AccessEvaluationRequest } from "../domain/authzen";
import type {
  ControlPlaneState,
  EnforcementResult,
} from "../domain/policy";

interface PepSimulatorPanelProps {
  client: ControlPlaneController;
  state: ControlPlaneState | null;
  onEvaluation(result: EnforcementResult | null, request: AccessEvaluationRequest): void;
}

const personas = [
  { id: "alice", role: "viewer" },
  { id: "bob", role: "editor" },
  { id: "carol", role: "admin" },
] as const;

const resources = [
  {
    id: "report-1",
    type: "report",
    owner: "bob",
    status: "draft",
  },
  {
    id: "report-2",
    type: "report",
    owner: "alice",
    status: "published",
  },
  {
    id: "workspace-prod",
    type: "workspace",
    owner: "carol",
  },
] as const;

const actions = ["read_report", "publish_report", "delete_workspace"] as const;

export default function PepSimulatorPanel({
  client,
  state,
  onEvaluation,
}: PepSimulatorPanelProps) {
  const [personaId, setPersonaId] = useState<(typeof personas)[number]["id"]>("alice");
  const [resourceId, setResourceId] = useState<(typeof resources)[number]["id"]>("report-1");
  const [result, setResult] = useState<EnforcementResult | null>(null);
  const [lastRequest, setLastRequest] = useState<AccessEvaluationRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function evaluate(action: (typeof actions)[number]) {
    const persona = personas.find((item) => item.id === personaId);
    const resource = resources.find((item) => item.id === resourceId);
    if (!persona || !resource) {
      setError("Select a valid persona and resource.");
      return;
    }
    const request: AccessEvaluationRequest = {
      subject: {
        type: "user",
        id: persona.id,
        properties: { role: persona.role, roles: [persona.role] },
      },
      resource: {
        type: resource.type,
        id: resource.id,
        properties: {
          owner: resource.owner,
          ...("status" in resource ? { status: resource.status } : {}),
        },
      },
      action: { name: action },
      context: {
        authenticated: true,
        source: "policy-control-plane",
        requested_at: new Date().toISOString(),
      },
    };

    setPendingAction(action);
    setError(null);
    setResult(null);
    setLastRequest(request);
    try {
      const evaluation = await client.enforceAccess(request);
      setResult(evaluation);
      onEvaluation(evaluation, request);
    } catch (evaluationError) {
      setError(errorMessage(evaluationError));
      onEvaluation(null, request);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="panel simulator-panel" aria-labelledby="simulator-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">01 / ENFORCEMENT</p>
          <h2 id="simulator-title">PEP simulator</h2>
        </div>
        <span className="live-indicator"><i /> Live</span>
      </header>

      <div className="simulator-fields">
        <label>
          Persona
          <select value={personaId} onChange={(event) => {
            if (isPersonaId(event.target.value)) setPersonaId(event.target.value);
          }}>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.id} · {persona.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resource
          <select value={resourceId} onChange={(event) => {
            if (isResourceId(event.target.value)) setResourceId(event.target.value);
          }}>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.id} · {resource.type}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="action-list" aria-label="Authorization actions">
        {actions.map((action) => (
          <button
            className="action-button"
            disabled={pendingAction !== null}
            key={action}
            onClick={() => void evaluate(action)}
            type="button"
          >
            <span>{action}</span>
            {pendingAction === action ? <span className="spinner" aria-label="Evaluating" /> : <span aria-hidden="true">→</span>}
          </button>
        ))}
      </div>

      {pendingAction && <p className="inline-status">Evaluating request with the Go OPA PDP…</p>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {result && (
        <div className={`decision-banner ${result.response.decision ? "decision-allow" : "decision-deny"}`}>
          <div className="decision-heading">
            <strong>{result.httpStatus} {result.response.decision ? "ALLOW" : "DENY"}</strong>
            <span>{result.response.context?.policy_version ?? "policy version unavailable"}</span>
          </div>
          <ul>
            {(result.response.context?.reasons?.length
              ? result.response.context.reasons
              : ["No decision reason was returned."]).map((reason, index) => (
                <li key={`${reason}-${index}`}>{reason}</li>
              ))}
          </ul>
        </div>
      )}

      <details className="json-inspector">
        <summary>Raw AuthZEN request / response</summary>
        <div className="inspector-grid">
          <div>
            <span className="code-label">REQUEST</span>
            <pre>{lastRequest ? JSON.stringify(lastRequest, null, 2) : "Run an evaluation to inspect the request."}</pre>
          </div>
          <div>
            <span className="code-label">RESPONSE</span>
            <pre>{result ? JSON.stringify(result.response, null, 2) : "No response yet."}</pre>
          </div>
        </div>
      </details>

      <div className="section-divider">
        <div>
          <p className="eyebrow">DURABLE OBJECT · SQLITE</p>
          <h3>Recent audit events</h3>
        </div>
        <span className="count-pill">{state?.auditLogs.length ?? 0}</span>
      </div>
      <div className="table-scroll">
        <table className="audit-table">
          <thead>
            <tr><th>Event</th><th>Subject / action</th><th>Result</th><th>Time</th></tr>
          </thead>
          <tbody>
            {state?.auditLogs.slice(0, 10).map((entry, index) => {
              const decision = entry.response?.decision;
              return (
                <tr key={entry.id ?? `${entry.occurredAt}-${index}`}>
                  <td>{entry.eventType.replaceAll("_", " ")}</td>
                  <td>{entry.request ? `${entry.request.subject.id} / ${entry.request.action.name}` : "—"}</td>
                  <td>
                    {decision === undefined
                      ? "—"
                      : <span className={`table-decision ${decision ? "text-allow" : "text-deny"}`}>{decision ? "ALLOW" : "DENY"}</span>}
                  </td>
                  <td>{formatTime(entry.occurredAt)}</td>
                </tr>
              );
            })}
            {!state?.auditLogs.length && (
              <tr><td className="empty-cell" colSpan={4}>No audit events have been recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPersonaId(value: string): value is (typeof personas)[number]["id"] {
  return personas.some((persona) => persona.id === value);
}

function isResourceId(value: string): value is (typeof resources)[number]["id"] {
  return resources.some((resource) => resource.id === value);
}
