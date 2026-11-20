import { useMemo, useState } from "react";
import type { ControlPlaneController } from "../application/ControlPlaneController";
import type { ControlPlaneState } from "../domain/policy";
import { createLineDiff } from "../domain/lineDiff";

interface RegoPolicyStudioProps {
  client: ControlPlaneController;
  state: ControlPlaneState | null;
  onApproved(): void;
}

export default function RegoPolicyStudio({
  client,
  state,
  onApproved,
}: RegoPolicyStudioProps) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = state?.activePolicy ?? null;
  const candidate = state?.candidatePolicy ?? null;
  const diff = useMemo(
    () => createLineDiff(active?.regoCode ?? "", candidate?.regoCode ?? ""),
    [active?.regoCode, candidate?.regoCode],
  );

  async function approveCandidate() {
    if (!candidate) return;
    setApproving(true);
    setError(null);
    try {
      await client.approvePolicy(candidate.id);
      onApproved();
    } catch (approvalError) {
      setError(errorMessage(approvalError));
    } finally {
      setApproving(false);
    }
  }

  return (
    <section className="panel policy-panel" aria-labelledby="policy-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">02 / POLICY CONTROL</p>
          <h2 id="policy-title">Rego policy studio</h2>
        </div>
        <span className="status-pill status-neutral">OPA bundle</span>
      </header>

      <div className="active-policy-card">
        <div className="policy-meta">
          <div>
            <span className="code-label">ACTIVE POLICY</span>
            <strong>{active ? `v${active.version}` : "Not initialized"}</strong>
          </div>
          {active && <span className="muted-text">Activated {formatDate(active.activatedAt)}</span>}
        </div>
        <pre className="rego-code">{active?.regoCode ?? "package authz\n\nimport rego.v1\n\ndefault allow := false"}</pre>
      </div>

      <div className="candidate-heading">
        <div>
          <span className="code-label">PENDING CANDIDATE</span>
          <h3>{candidate ? candidate.version : "No policy awaiting review"}</h3>
        </div>
        {candidate && <span className="status-pill status-valid">OPA validation passed</span>}
      </div>

      {candidate ? (
        <>
          <p className="candidate-explanation">{candidate.explanation}</p>
          <div className="diff-toolbar">
            <span><i className="diff-dot diff-added" /> Added</span>
            <span><i className="diff-dot diff-removed" /> Removed</span>
            <span className="diff-source">Active → candidate</span>
          </div>
          <div className="diff-view" role="region" aria-label="Line-by-line policy diff">
            {diff.map((line, index) => (
              <div className={`diff-line diff-${line.kind}`} key={`${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${index}`}>
                <span className="diff-number">{line.oldLine ?? ""}</span>
                <span className="diff-number">{line.newLine ?? ""}</span>
                <span className="diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                <code>{line.text || " "}</code>
              </div>
            ))}
          </div>
          <button
            className="primary-button approve-button"
            disabled={approving}
            onClick={() => void approveCandidate()}
            type="button"
          >
            {approving ? <><span className="spinner" /> Syncing policy…</> : "Approve & Sync to OPA Bundle"}
          </button>
        </>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">⌘</span>
          <p>Generated policy candidates appear here after OPA validation.</p>
          <span className="muted-text">Review the diff before syncing a new version.</span>
        </div>
      )}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
