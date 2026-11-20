import type { PolicyStoragePort } from "../application/ports";
import type {
  AuditLogEntry,
  CandidatePolicy,
  ChatMessage,
  PolicyVersion,
  WorkflowProgress,
} from "../domain/policy";

type VersionRow = {
  id: string;
  version: string;
  rego_code: string;
  created_at: string;
  activated_at: string;
};

type CandidateRow = {
  id: string;
  version: string;
  rego_code: string;
  original_prompt: string;
  explanation: string;
  created_at: string;
  status: string;
};

type AuditRow = {
  id: number;
  event_type: string;
  occurred_at: string;
  request_json: string | null;
  response_json: string | null;
  details_json: string | null;
};

type ChatRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  workflow_id: string | null;
  created_at: string;
};

type WorkflowProgressRow = {
  workflow_id: string;
  step: WorkflowProgress["step"];
  updated_at: string;
};

export class SqlitePolicyStorageAdapter implements PolicyStoragePort {
  constructor(private readonly sql: SqlStorage) {}

  async initSchema(): Promise<void> {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS policy_versions (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        rego_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS candidate_policies (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        rego_code TEXT NOT NULL,
        original_prompt TEXT NOT NULL,
        explanation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        request_json TEXT,
        response_json TEXT,
        details_json TEXT
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        workflow_id TEXT,
        created_at TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS workflow_progress (
        workflow_id TEXT PRIMARY KEY,
        step TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
  }

  async seedDefaultPolicyIfEmpty(rego: string): Promise<void> {
    const normalized = rego.trim();
    if (!hasRegoV1Headers(normalized)) {
      throw new Error("seed policy must begin with package authz and import rego.v1");
    }
    const existing = this.sql
      .exec<{ id: string }>("SELECT id FROM policy_versions LIMIT 1")
      .toArray();
    if (existing.length > 0) {
      return;
    }
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO policy_versions (id, version, rego_code, created_at, activated_at)
       VALUES (?, ?, ?, ?, ?)`,
      "seed-v1",
      "1",
      rego,
      now,
      now,
    );
  }

  async getActivePolicy(): Promise<PolicyVersion | null> {
    const rows = this.sql
      .exec<VersionRow>(
        `SELECT id, version, rego_code, created_at, activated_at
         FROM policy_versions ORDER BY activated_at DESC, rowid DESC LIMIT 1`,
      )
      .toArray();
    return rows.length === 0 ? null : toPolicyVersion(rows[0]);
  }

  async listPolicyVersions(): Promise<PolicyVersion[]> {
    return this.sql
      .exec<VersionRow>(
        `SELECT id, version, rego_code, created_at, activated_at
         FROM policy_versions ORDER BY activated_at DESC, rowid DESC`,
      )
      .toArray()
      .map(toPolicyVersion);
  }

  async saveCandidatePolicy(candidate: CandidatePolicy): Promise<void> {
    if (!hasRegoV1Headers(candidate.regoCode)) {
      throw new Error("candidate policy must begin with package authz and import rego.v1");
    }
    this.sql.exec(
      `INSERT INTO candidate_policies
       (id, version, rego_code, original_prompt, explanation, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'candidate')`,
      candidate.id,
      candidate.version,
      candidate.regoCode,
      candidate.originalPrompt,
      candidate.explanation,
      candidate.createdAt,
    );
  }

  async getLatestCandidate(): Promise<CandidatePolicy | null> {
    const rows = this.sql
      .exec<CandidateRow>(
        `SELECT id, version, rego_code, original_prompt, explanation, created_at, status
         FROM candidate_policies WHERE status = 'candidate'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .toArray();
    return rows.length === 0 ? null : toCandidatePolicy(rows[0]);
  }

  async approveCandidate(candidateId: string): Promise<PolicyVersion> {
    const candidates = this.sql
      .exec<CandidateRow>(
        `SELECT id, version, rego_code, original_prompt, explanation, created_at, status
         FROM candidate_policies WHERE id = ? AND status = 'candidate' LIMIT 1`,
        candidateId,
      )
      .toArray();
    const candidateRow = candidates[0];
    if (!candidateRow) {
      throw new Error(`candidate policy not found: ${candidateId}`);
    }
    const activatedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO policy_versions (id, version, rego_code, created_at, activated_at)
       VALUES (?, ?, ?, ?, ?)`,
      candidateRow.id,
      candidateRow.version,
      candidateRow.rego_code,
      candidateRow.created_at,
      activatedAt,
    );
    const update = this.sql.exec(
      `UPDATE candidate_policies SET status = 'approved'
       WHERE id = ? AND status = 'candidate'`,
      candidateId,
    );
    if (update.rowsWritten !== 1) {
      throw new Error(`candidate policy approval state changed: ${candidateId}`);
    }
    return {
      id: candidateRow.id,
      version: candidateRow.version,
      regoCode: candidateRow.rego_code,
      createdAt: candidateRow.created_at,
      activatedAt,
    };
  }

  async appendAuditLog(entry: AuditLogEntry): Promise<void> {
    this.sql.exec(
      `INSERT INTO audit_logs
       (event_type, occurred_at, request_json, response_json, details_json)
       VALUES (?, ?, ?, ?, ?)`,
      entry.eventType,
      entry.occurredAt,
      stringify(entry.request),
      stringify(entry.response),
      stringify(entry.details),
    );
  }

  async listAuditLogs(limit: number): Promise<AuditLogEntry[]> {
    const rows = this.sql
      .exec<AuditRow>(
        `SELECT id, event_type, occurred_at, request_json, response_json, details_json
         FROM audit_logs ORDER BY id DESC LIMIT ?`,
        boundedLimit(limit),
      )
      .toArray();
    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      request: parseOptionalJson<AuditLogEntry["request"]>(row.request_json),
      response: parseOptionalJson<AuditLogEntry["response"]>(row.response_json),
      details: parseOptionalJson<AuditLogEntry["details"]>(row.details_json),
    }));
  }

  async appendChatMessage(message: ChatMessage): Promise<void> {
    this.sql.exec(
      `INSERT INTO chat_messages (role, content, workflow_id, created_at)
       VALUES (?, ?, ?, ?)`,
      message.role,
      message.content,
      message.workflowId ?? null,
      message.createdAt,
    );
  }

  async listChatMessages(limit: number): Promise<ChatMessage[]> {
    return this.sql
      .exec<ChatRow>(
        `SELECT id, role, content, workflow_id, created_at
         FROM chat_messages ORDER BY id DESC LIMIT ?`,
        boundedLimit(limit),
      )
      .toArray()
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        workflowId: row.workflow_id ?? undefined,
        createdAt: row.created_at,
      }));
  }

  async setWorkflowProgress(workflowId: string, step: WorkflowProgress["step"]): Promise<void> {
    this.sql.exec(
      `INSERT INTO workflow_progress (workflow_id, step, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(workflow_id) DO UPDATE SET
         step = excluded.step,
         updated_at = excluded.updated_at`,
      workflowId,
      step,
      new Date().toISOString(),
    );
  }

  async getWorkflowProgress(workflowId: string): Promise<WorkflowProgress | null> {
    const rows = this.sql
      .exec<WorkflowProgressRow>(
        `SELECT workflow_id, step, updated_at
         FROM workflow_progress WHERE workflow_id = ? LIMIT 1`,
        workflowId,
      )
      .toArray();
    const row = rows[0];
    return row
      ? { workflowId: row.workflow_id, step: row.step, updatedAt: row.updated_at }
      : null;
  }
}

function toPolicyVersion(row: VersionRow): PolicyVersion {
  return {
    id: row.id,
    version: row.version,
    regoCode: row.rego_code,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

function toCandidatePolicy(row: CandidateRow): CandidatePolicy {
  return {
    id: row.id,
    version: row.version,
    regoCode: row.rego_code,
    originalPrompt: row.original_prompt,
    explanation: row.explanation,
    createdAt: row.created_at,
  };
}

function hasRegoV1Headers(regoCode: string): boolean {
  const lines = regoCode.replaceAll("\r\n", "\n").split("\n");
  return lines[0]?.trim() === "package authz" && lines[1]?.trim() === "import rego.v1";
}

function stringify(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("value cannot be serialized as JSON");
  }
  return serialized;
}

function parseOptionalJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : JSON.parse(value) as T;
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(limit, 500);
}
