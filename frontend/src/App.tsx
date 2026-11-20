import { useCallback, useEffect, useState } from "react";
import type { ControlPlaneController } from "./application/ControlPlaneController";
import type {
  AccessEvaluationRequest,
  AuthZenConfiguration,
} from "./domain/authzen";
import type {
  ControlPlaneState,
  EnforcementResult,
} from "./domain/policy";
import PepSimulatorPanel from "./components/PepSimulatorPanel";
import PolicyCopilotChat from "./components/PolicyCopilotChat";
import RegoPolicyStudio from "./components/RegoPolicyStudio";

interface AppProps {
  client: ControlPlaneController;
}

export default function App({ client }: AppProps) {
  const [state, setState] = useState<ControlPlaneState | null>(null);
  const [configuration, setConfiguration] = useState<AuthZenConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [lastDenial, setLastDenial] = useState<{
    request: AccessEvaluationRequest;
    response: EnforcementResult["response"];
  } | null>(null);

  const refreshState = useCallback(async (showProgress = false) => {
    if (showProgress) setRefreshing(true);
    try {
      setState(await client.getState());
      setStateError(null);
    } catch (refreshError) {
      setStateError(errorMessage(refreshError));
    } finally {
      setLoading(false);
      if (showProgress) setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshState();
    void client.getConfiguration()
      .then((metadata) => {
        setConfiguration(metadata);
        setConfigurationError(null);
      })
      .catch((discoveryError: unknown) => setConfigurationError(errorMessage(discoveryError)));
  }, [client, refreshState]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshState(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshState]);

  function handleEvaluation(result: EnforcementResult | null, request: AccessEvaluationRequest) {
    setLastDenial(
      result && !result.response.decision ? { request, response: result.response } : null,
    );
    void refreshState();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Policy Control Plane home">
          <span className="brand-mark"><span /></span>
          <span>POLICY<span className="brand-light">PLANE</span></span>
        </a>
        <div className="topbar-center">
          <span className="environment-tag"><i /> DEVELOPMENT</span>
          <span className="topbar-divider" />
          <span className="topbar-caption">OpenID AuthZEN · OPA · Cloudflare</span>
        </div>
        <button className="refresh-button" onClick={() => void refreshState(true)} type="button" disabled={loading || refreshing}>
          <span className={loading || refreshing ? "refresh-icon spinning" : "refresh-icon"}>↻</span>
          <span>{loading ? "Loading" : refreshing ? "Refreshing state" : "Refresh state"}</span>
        </button>
      </header>

      <section className="page-intro">
        <div>
          <p className="eyebrow">AUTHORIZATION CONTROL PLANE</p>
          <h1>Policy operations, <span>in one place.</span></h1>
          <p className="intro-copy">Simulate decisions, inspect policy changes, and author new rules with AI assistance.</p>
        </div>
        <div className="connection-card">
          <div className="connection-heading"><span className="connection-dot" /> PDP discovery</div>
          {configuration ? (
            <>
              <span className="connection-url">{configuration.policy_decision_point}</span>
              <span className="muted-text">{configuration.access_evaluation_endpoint}</span>
            </>
          ) : (
            <span className={configurationError ? "connection-error" : "muted-text"}>
              {configurationError ?? "Connecting to AuthZEN PDP…"}
            </span>
          )}
        </div>
      </section>

      {stateError && (
        <div className="global-error" role="alert">
          <strong>Control plane state unavailable.</strong> {stateError}
          <button onClick={() => void refreshState()} type="button">Retry</button>
        </div>
      )}

      <div className="control-grid">
        <PepSimulatorPanel client={client} onEvaluation={handleEvaluation} state={state} />
        <RegoPolicyStudio client={client} onApproved={() => void refreshState()} state={state} />
        <PolicyCopilotChat
          client={client}
          lastDenial={lastDenial}
          onRefresh={refreshState}
          state={state}
        />
      </div>

      <footer className="app-footer">
        <span>POLICYPLANE <span className="footer-separator">/</span> AUTHZEN 1.0</span>
        <span>{state?.activePolicy ? `Active policy ${state.activePolicy.version}` : "Awaiting policy state"}</span>
      </footer>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
