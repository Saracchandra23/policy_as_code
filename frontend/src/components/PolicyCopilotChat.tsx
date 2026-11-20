import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ControlPlaneController } from "../application/ControlPlaneController";
import type { AccessEvaluationRequest, AccessEvaluationResponse } from "../domain/authzen";
import type {
  ChatMessage,
  ControlPlaneState,
  WorkflowStatus,
} from "../domain/policy";

const examplePrompts = [
  "Allow editors to delete their own draft reports",
  "Require admins to publish reports",
  "Let report owners read published reports",
];

interface PolicyCopilotChatProps {
  client: ControlPlaneController;
  state: ControlPlaneState | null;
  lastDenial: {
    request: AccessEvaluationRequest;
    response: AccessEvaluationResponse;
  } | null;
  onRefresh(): Promise<void>;
}

export default function PolicyCopilotChat({
  client,
  state,
  lastDenial,
  onRefresh,
}: PolicyCopilotChatProps) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.chatMessages.length, explanation]);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await client.getWorkflowStatus(workflowId, "default");
        if (cancelled) return;
        setWorkflowStatus(status);
        if (isTerminal(status.status)) {
          setWorkflowId(null);
          await onRefresh();
          return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (pollError) {
        if (!cancelled) {
          setError(errorMessage(pollError));
          setWorkflowId(null);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, onRefresh, workflowId]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || submitting || workflowId) return;
    setSubmitting(true);
    setError(null);
    setExplanation(null);
    try {
      const result = await client.postChat({ message, mode: "author_policy", workspaceId: "default" });
      setPrompt("");
      if ("workflowId" in result) {
        setWorkflowStatus({ status: "queued" });
        setWorkflowId(result.workflowId);
      }
      await onRefresh();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function explainDenial() {
    if (!lastDenial || explaining) return;
    setExplaining(true);
    setError(null);
    setExplanation(null);
    try {
      const result = await client.postChat({
        message: "Explain the last authorization denial.",
        mode: "explain_denial",
        request: lastDenial.request,
        response: lastDenial.response,
        workspaceId: "default",
      });
      if ("explanation" in result) setExplanation(result.explanation);
      await onRefresh();
    } catch (explainError) {
      setError(errorMessage(explainError));
    } finally {
      setExplaining(false);
    }
  }

  const messages = state?.chatMessages ?? [];
  const activeWorkflow = workflowId !== null;

  return (
    <section className="panel copilot-panel" aria-labelledby="copilot-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">03 / POLICY AUTHORING</p>
          <h2 id="copilot-title">Policy copilot</h2>
        </div>
        <span className="ai-chip"><span>✦</span> LLAMA 3.3</span>
      </header>

      <div className="chat-history" aria-live="polite">
        {messages.length === 0 && !explanation && (
          <div className="chat-intro">
            <span className="copilot-avatar">✦</span>
            <div>
              <strong>What should the policy do?</strong>
              <p>Describe a rule in plain English. I’ll generate Rego v1 and validate it with OPA.</p>
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <ChatBubble key={message.id ?? `${message.createdAt}-${index}`} message={message} />
        ))}
        {explanation && !messages.some((message) => message.role === "assistant" && message.content === explanation) && (
          <ChatBubble message={{ role: "assistant", content: explanation, createdAt: new Date().toISOString() }} />
        )}
        <div ref={chatEndRef} />
      </div>

      {workflowStatus && (
        <WorkflowProgress status={workflowStatus} running={activeWorkflow} />
      )}
      {error && <div className="notice notice-error chat-error" role="alert">{error}</div>}

      <div className="prompt-suggestions">
        {examplePrompts.map((example) => (
          <button
            disabled={submitting || activeWorkflow}
            key={example}
            onClick={() => setPrompt(example)}
            type="button"
          >
            {example}
          </button>
        ))}
      </div>

      <form className="chat-composer" onSubmit={(event) => void submitPrompt(event)}>
        <label className="visually-hidden" htmlFor="policy-prompt">Describe a policy rule</label>
        <textarea
          id="policy-prompt"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe a policy change…"
          rows={3}
          value={prompt}
          disabled={submitting || activeWorkflow}
        />
        <div className="composer-footer">
          <span>Generated rules are validated before approval.</span>
          <button
            className="send-button"
            disabled={!prompt.trim() || submitting || activeWorkflow}
            type="submit"
            aria-label="Generate policy"
          >
            {submitting ? <span className="spinner" /> : "↑"}
          </button>
        </div>
      </form>

      <button
        className="explain-button"
        disabled={!lastDenial || explaining}
        onClick={() => void explainDenial()}
        type="button"
      >
        {explaining ? <span className="spinner" /> : "✦"} Explain last denial
      </button>
    </section>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`chat-message message-${message.role}`}>
      {message.role === "assistant" && <span className="message-avatar">✦</span>}
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "assistant" ? "Policy Copilot" : "You"}</strong>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <p>{message.content}</p>
      </div>
    </article>
  );
}

function WorkflowProgress({ status, running }: { status: WorkflowStatus; running: boolean }) {
  const steps = ["Generating Rego v1", "Validating with Go OPA", "Auto-repairing if needed", "Ready for review"];
  const terminalError = status.status === "errored" || status.status === "terminated";
  const stageIndex: Record<NonNullable<WorkflowStatus["progress"]>["step"], number> = {
    "generate-rego-v1": 0,
    "validate-with-opa": 1,
    "auto-repair-if-invalid": 2,
    "persist-candidate": 3,
    ready: 3,
  };
  const activeIndex = status.status === "complete"
    ? 3
    : running && status.progress
      ? stageIndex[status.progress.step]
      : -1;
  const waitingForStage = running && !status.progress;

  return (
    <div className={`workflow-progress ${terminalError ? "workflow-failed" : ""}`}>
      <div className="workflow-status-line">
        <span className={`workflow-state-dot ${running ? "is-running" : ""}`} />
        <strong>{terminalError ? "Workflow failed" : running ? status.progress ? steps[activeIndex] : "Workflow running" : status.status === "complete" ? "Candidate is ready" : `Workflow ${status.status}`}</strong>
        {running && <span className="muted-text">refreshing every 1.5s</span>}
      </div>
      <ol className="workflow-steps">
        {steps.map((step, index) => {
          const done = status.status === "complete" || index < activeIndex;
          const current = running && index === activeIndex;
          return (
            <li className={`${done ? "step-done" : ""} ${current ? "step-current" : ""}`} key={step}>
              <span className="step-marker">{done ? "✓" : index + 1}</span>
              {step}
            </li>
          );
        })}
      </ol>
      {waitingForStage && <p className="workflow-error">Waiting for the first durable workflow stage to report progress.</p>}
      {terminalError && <p className="workflow-error">{status.error?.message ?? "The policy workflow did not complete."}</p>}
    </div>
  );
}

function isTerminal(status: WorkflowStatus["status"]): boolean {
  return status === "complete" || status === "errored" || status === "terminated";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
