import { Pool } from 'pg';
import { AgentLogEntry, Decision, ActionEntry, Initiative, AgentName, EventType } from '../types';
import { IStorageClient, AgentKey } from './storageInterface';

const PERMISSIONS: Record<AgentKey, string[]> = {
  marketing: ['agent_log', 'decisions', 'initiatives'],
  finance: ['agent_log', 'decisions', 'initiatives', 'policies'],
  engineering: ['actions', 'decisions', 'agent_log'],
  orchestrator: ['initiatives', 'agent_log', 'decisions', 'actions', 'policies']
};

export class PostgresClientWrapper implements IStorageClient {
  private pool: Pool;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/corpusai';
    this.pool = new Pool({
      connectionString: connStr,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
  }

  checkPermission(agent: AgentKey, resource: string, actionDescription: string): void {
    const allowed = PERMISSIONS[agent]?.includes(resource);
    if (!allowed && agent !== 'orchestrator') {
      const errorMsg = `Security Check Failed: Agent '${agent}' is not allowed to access resource type '${resource}' for action: ${actionDescription}`;
      console.error(`\x1b[31m[SECURITY BLOCK] ${errorMsg}\x1b[0m`);
      throw new Error(errorMsg);
    }
  }

  // --- Initiatives ---

  async createInitiative(name: string, owner: string, summary: string): Promise<Initiative> {
    this.checkPermission('orchestrator', 'initiatives', 'createInitiative');
    const query = `
      INSERT INTO initiatives (name, owner, summary, status)
      VALUES ($1, $2, $3, 'Planning')
      RETURNING id, name, status, owner, created, summary;
    `;
    const res = await this.pool.query(query, [name, owner, summary]);
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      owner: row.owner,
      created: row.created.toISOString(),
      summary: row.summary
    };
  }

  async updateInitiativeStatus(id: string, status: Initiative['status'], summaryUpdate?: string): Promise<void> {
    this.checkPermission('orchestrator', 'initiatives', 'updateInitiativeStatus');
    let query = `UPDATE initiatives SET status = $1, updated = NOW() WHERE id = $2`;
    let params: any[] = [status, id];

    if (summaryUpdate) {
      query = `UPDATE initiatives SET status = $1, summary = $2, updated = NOW() WHERE id = $3`;
      params = [status, summaryUpdate, id];
    }
    await this.pool.query(query, params);
  }

  async getInitiative(id: string): Promise<Initiative> {
    this.checkPermission('orchestrator', 'initiatives', 'getInitiative');
    const res = await this.pool.query(`SELECT * FROM initiatives WHERE id = $1`, [id]);
    if (res.rows.length === 0) throw new Error(`Initiative not found: ${id}`);
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      owner: row.owner,
      created: row.created.toISOString(),
      summary: row.summary
    };
  }

  async getAllInitiatives(): Promise<Initiative[]> {
    this.checkPermission('orchestrator', 'initiatives', 'getAllInitiatives');
    const res = await this.pool.query(`SELECT * FROM initiatives ORDER BY created DESC`);
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      owner: row.owner,
      created: row.created.toISOString(),
      summary: row.summary
    }));
  }

  // --- Agent Logs ---

  async createAgentLog(agentKey: AgentKey, log: Omit<AgentLogEntry, 'timestamp'>): Promise<void> {
    this.checkPermission(agentKey, 'agent_log', 'createAgentLog');
    const query = `
      INSERT INTO agent_logs (initiative_id, agent, event_type, summary, reasoning)
      VALUES ($1, $2, $3, $4, $5);
    `;
    await this.pool.query(query, [log.initiativeId, log.agent, log.eventType, log.summary, log.reasoning]);
  }

  async getAgentLogsForInitiative(initiativeId: string): Promise<AgentLogEntry[]> {
    this.checkPermission('orchestrator', 'agent_log', 'getAgentLogsForInitiative');
    const res = await this.pool.query(
      `SELECT * FROM agent_logs WHERE initiative_id = $1 ORDER BY created_at ASC`,
      [initiativeId]
    );
    return res.rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at.toISOString(),
      agent: row.agent as AgentName,
      eventType: row.event_type as EventType,
      summary: row.summary,
      reasoning: row.reasoning,
      initiativeId: row.initiative_id
    }));
  }

  async getAllAgentLogs(): Promise<AgentLogEntry[]> {
    this.checkPermission('orchestrator', 'agent_log', 'getAllAgentLogs');
    const res = await this.pool.query(`SELECT * FROM agent_logs ORDER BY created_at ASC`);
    return res.rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at.toISOString(),
      agent: row.agent as AgentName,
      eventType: row.event_type as EventType,
      summary: row.summary,
      reasoning: row.reasoning,
      initiativeId: row.initiative_id
    }));
  }

  // --- Decisions ---

  async createDecision(agentKey: AgentKey, decision: Omit<Decision, 'status'>): Promise<Decision> {
    this.checkPermission(agentKey, 'decisions', 'createDecision');
    const query = `
      INSERT INTO decisions (initiative_id, title, requested_by, amount, reasoning_summary, status)
      VALUES ($1, $2, $3, $4, $5, 'Pending')
      RETURNING *;
    `;
    const res = await this.pool.query(query, [
      decision.initiativeId,
      decision.title,
      decision.requestedBy,
      decision.amount,
      decision.reasoningSummary
    ]);
    const row = res.rows[0];
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      requestedBy: row.requested_by as AgentName,
      amount: Number(row.amount),
      reasoningSummary: row.reasoning_summary,
      initiativeId: row.initiative_id,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : undefined
    };
  }

  async getDecision(id: string): Promise<Decision> {
    this.checkPermission('orchestrator', 'decisions', 'getDecision');
    const res = await this.pool.query(`SELECT * FROM decisions WHERE id = $1`, [id]);
    if (res.rows.length === 0) throw new Error(`Decision not found: ${id}`);
    const row = res.rows[0];
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      requestedBy: row.requested_by as AgentName,
      amount: Number(row.amount),
      reasoningSummary: row.reasoning_summary,
      initiativeId: row.initiative_id,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : undefined
    };
  }

  async getPendingDecisions(): Promise<Decision[]> {
    this.checkPermission('orchestrator', 'decisions', 'getPendingDecisions');
    const res = await this.pool.query(`SELECT * FROM decisions WHERE status = 'Pending'`);
    return res.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      requestedBy: row.requested_by as AgentName,
      amount: Number(row.amount),
      reasoningSummary: row.reasoning_summary,
      initiativeId: row.initiative_id
    }));
  }

  async getRecentApprovedDecisions(): Promise<Decision[]> {
    this.checkPermission('orchestrator', 'decisions', 'getRecentApprovedDecisions');
    const res = await this.pool.query(
      `SELECT * FROM decisions WHERE status = 'Approved' ORDER BY decided_at DESC LIMIT 50`
    );
    return res.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      requestedBy: row.requested_by as AgentName,
      amount: Number(row.amount),
      reasoningSummary: row.reasoning_summary,
      initiativeId: row.initiative_id,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : undefined
    }));
  }

  async getAllDecisions(): Promise<Decision[]> {
    this.checkPermission('orchestrator', 'decisions', 'getAllDecisions');
    const res = await this.pool.query(`SELECT * FROM decisions ORDER BY created_at DESC`);
    return res.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      requestedBy: row.requested_by as AgentName,
      amount: Number(row.amount),
      reasoningSummary: row.reasoning_summary,
      initiativeId: row.initiative_id,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : undefined
    }));
  }

  async updateDecisionStatus(id: string, status: Decision['status'], decidedBy = 'Human Director'): Promise<void> {
    this.checkPermission('orchestrator', 'decisions', 'updateDecisionStatus');
    const query = `
      UPDATE decisions
      SET status = $1, decided_by = $2, decided_at = NOW()
      WHERE id = $3;
    `;
    await this.pool.query(query, [status, decidedBy, id]);
  }

  // --- Actions ---

  async createAction(agentKey: AgentKey, action: Omit<ActionEntry, 'timestamp'>): Promise<void> {
    this.checkPermission(agentKey, 'actions', 'createAction');
    const query = `
      INSERT INTO actions (initiative_id, title, tool, link, performed_by)
      VALUES ($1, $2, $3, $4, $5);
    `;
    await this.pool.query(query, [
      action.initiativeId,
      action.title,
      action.tool,
      action.link,
      action.performedBy
    ]);
  }

  async getAllActions(initiativeId?: string): Promise<ActionEntry[]> {
    this.checkPermission('orchestrator', 'actions', 'getAllActions');
    let query = `SELECT * FROM actions ORDER BY created_at DESC`;
    let params: any[] = [];
    if (initiativeId) {
      query = `SELECT * FROM actions WHERE initiative_id = $1 ORDER BY created_at DESC`;
      params = [initiativeId];
    }
    const res = await this.pool.query(query, params);
    return res.rows.map((row) => ({
      id: row.id,
      title: row.title,
      tool: row.tool as any,
      link: row.link,
      performedBy: row.performed_by as AgentName,
      initiativeId: row.initiative_id,
      timestamp: row.created_at.toISOString()
    }));
  }

  // --- Policy ---

  async readPolicyPage(): Promise<string> {
    this.checkPermission('finance', 'policies', 'readPolicyPage');
    const res = await this.pool.query(
      `SELECT content FROM policies WHERE policy_key = 'company_budget_policy' LIMIT 1;`
    );
    if (res.rows.length > 0) {
      return res.rows[0].content;
    }
    return `Corporate Budget Policy:\n1. Under $5,000: Auto-approved.\n2. $5,000-$10,000: Soft threshold.\n3. Over $10,000: Hard limit.`;
  }
}
