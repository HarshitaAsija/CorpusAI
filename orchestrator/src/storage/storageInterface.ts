import { AgentLogEntry, Decision, ActionEntry, Initiative } from '../types';

export type AgentKey = 'marketing' | 'finance' | 'engineering' | 'orchestrator';

export interface IStorageClient {
  // Initiatives
  createInitiative(name: string, owner: string, summary: string): Promise<Initiative>;
  updateInitiativeStatus(id: string, status: Initiative['status'], summaryUpdate?: string): Promise<void>;
  getInitiative(id: string): Promise<Initiative>;
  getAllInitiatives(): Promise<Initiative[]>;

  // Agent Logs
  createAgentLog(agentKey: AgentKey, log: Omit<AgentLogEntry, 'timestamp'>): Promise<void>;
  getAgentLogsForInitiative(initiativeId: string): Promise<AgentLogEntry[]>;
  getAllAgentLogs(): Promise<AgentLogEntry[]>;

  // Decisions
  createDecision(agentKey: AgentKey, decision: Omit<Decision, 'status'>): Promise<Decision>;
  getDecision(id: string): Promise<Decision>;
  getPendingDecisions(): Promise<Decision[]>;
  getRecentApprovedDecisions(): Promise<Decision[]>;
  getAllDecisions(): Promise<Decision[]>;
  updateDecisionStatus(id: string, status: Decision['status'], decidedBy?: string): Promise<void>;

  // Actions / Deliverables
  createAction(agentKey: AgentKey, action: Omit<ActionEntry, 'timestamp'>): Promise<void>;
  getAllActions(initiativeId?: string): Promise<ActionEntry[]>;

  // Policy
  readPolicyPage(): Promise<string>;

  // Security / Scoping check
  checkPermission(agent: AgentKey, targetId: string, actionDescription: string): void;
}
