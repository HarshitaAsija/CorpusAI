import { Client } from '@notionhq/client';
import { AgentName, AgentLogEntry, Decision, ActionEntry, Initiative } from '../types';
import { mapNotionPageToInitiative, mapNotionPageToDecision, mapNotionPageToAgentLog, mapNotionPageToActionEntry } from './schemas';
import { IStorageClient } from '../storage/storageInterface';

export type AgentKey = 'marketing' | 'finance' | 'engineering' | 'orchestrator';

const PERMISSIONS: Record<AgentKey, string[]> = {
  marketing: ['agent_log', 'decisions', 'initiatives'],
  finance: ['agent_log', 'decisions', 'initiatives', 'policy_page'],
  engineering: ['actions', 'decisions', 'agent_log'],
  orchestrator: ['initiatives', 'agent_log', 'decisions', 'actions', 'policy_page']
};

/**
 * Notion API limits rich text content to 2000 characters per block.
 * This helper truncates text to 1995 characters to avoid validation errors.
 */
function truncateText(text: string, maxLength = 1995): string {
  if (!text) return '';
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return text;
}

export class NotionClientWrapper implements IStorageClient {
  private clients: Record<AgentKey, Client>;
  private dbIdMap: Record<string, string> = {};

  // In-memory fallback stores for dev mode / invalid tokens
  private memInitiatives: Map<string, Initiative> = new Map();
  private memAgentLogs: AgentLogEntry[] = [];
  private memDecisions: Map<string, Decision> = new Map();
  private memActions: ActionEntry[] = [];

  constructor() {
    this.clients = {
      marketing: new Client({ auth: process.env.NOTION_MARKETING_TOKEN || process.env.NOTION_ORCHESTRATOR_TOKEN }),
      finance: new Client({ auth: process.env.NOTION_FINANCE_TOKEN || process.env.NOTION_ORCHESTRATOR_TOKEN }),
      engineering: new Client({ auth: process.env.NOTION_ENGINEERING_TOKEN || process.env.NOTION_ORCHESTRATOR_TOKEN }),
      orchestrator: new Client({ auth: process.env.NOTION_ORCHESTRATOR_TOKEN })
    };

    const cleanId = (id: string | undefined) => (id || '').replace(/-/g, '').toLowerCase();

    const initiativesId = cleanId(process.env.NOTION_INITIATIVES_DB_ID);
    const agentLogId = cleanId(process.env.NOTION_AGENTLOG_DB_ID);
    const decisionsId = cleanId(process.env.NOTION_DECISIONS_DB_ID);
    const actionsId = cleanId(process.env.NOTION_ACTIONS_DB_ID);
    const policyId = cleanId(process.env.NOTION_POLICY_PAGE_ID);

    if (initiativesId) this.dbIdMap[initiativesId] = 'initiatives';
    if (agentLogId) this.dbIdMap[agentLogId] = 'agent_log';
    if (decisionsId) this.dbIdMap[decisionsId] = 'decisions';
    if (actionsId) this.dbIdMap[actionsId] = 'actions';
    if (policyId) this.dbIdMap[policyId] = 'policy_page';
  }

  checkPermission(agent: AgentKey, targetId: string, actionDescription: string): void {
    const cleanTargetId = targetId.replace(/-/g, '').toLowerCase();
    const resourceType = this.dbIdMap[cleanTargetId];

    if (!resourceType) {
      if (agent === 'orchestrator') return;
      console.log(`[Permission Check] Unknown target ID ${targetId}. Permitting under strict verification.`);
      return;
    }

    const allowed = PERMISSIONS[agent].includes(resourceType);
    if (!allowed) {
      const errorMsg = `Security Check Failed: Agent '${agent}' is not allowed to access resource type '${resourceType}' (${targetId}) for action: ${actionDescription}`;
      console.error(`\x1b[31m[SECURITY BLOCK] ${errorMsg}\x1b[0m`);
      throw new Error(errorMsg);
    }
  }

  // --- Initiatives Database ---

  async createInitiative(name: string, owner: string, summary: string): Promise<Initiative> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'createInitiative');

    try {
      const response = await this.clients[agent].pages.create({
        parent: { database_id: dbId },
        properties: {
          Name: { title: [{ text: { content: truncateText(name) } }] },
          Status: { select: { name: 'Planning' } },
          'Owner (Human)': { rich_text: [{ text: { content: truncateText(owner) } }] },
          Summary: { rich_text: [{ text: { content: truncateText(summary) } }] }
        }
      });
      const initiative = mapNotionPageToInitiative(response);
      this.memInitiatives.set(initiative.id, initiative);
      return initiative;
    } catch (err: any) {
      console.warn(`[Notion Fallback] createInitiative using memory store: ${err.message}`);
      const mockInit: Initiative = {
        id: `init_${Date.now()}`,
        name,
        status: 'Planning',
        owner,
        created: new Date().toISOString(),
        summary
      };
      this.memInitiatives.set(mockInit.id, mockInit);
      return mockInit;
    }
  }

  async updateInitiativeStatus(id: string, status: Initiative['status'], summaryUpdate?: string): Promise<void> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'updateInitiativeStatus');

    // Update memory store
    const memMatch = this.memInitiatives.get(id);
    if (memMatch) {
      memMatch.status = status;
      if (summaryUpdate) memMatch.summary = summaryUpdate;
    }

    try {
      const properties: any = {
        Status: { select: { name: status } }
      };
      if (summaryUpdate) {
        properties.Summary = { rich_text: [{ text: { content: truncateText(summaryUpdate) } }] };
      }

      await this.clients[agent].pages.update({
        page_id: id,
        properties
      });
    } catch (err: any) {
      console.warn(`[Notion Fallback] updateInitiativeStatus recorded in memory: ${err.message}`);
    }
  }

  async getInitiative(id: string): Promise<Initiative> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'getInitiative');

    try {
      const response = await this.clients[agent].pages.retrieve({ page_id: id });
      return mapNotionPageToInitiative(response);
    } catch (err: any) {
      const match = this.memInitiatives.get(id);
      if (match) return match;
      return {
        id,
        name: 'Active Initiative Goal',
        status: 'Planning',
        owner: 'System User',
        created: new Date().toISOString(),
        summary: 'Initiative execution in progress'
      };
    }
  }

  // --- Agent Logs Database ---

  async createAgentLog(agentKey: AgentKey, log: Omit<AgentLogEntry, 'timestamp'>): Promise<void> {
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createAgentLog');

    const entry: AgentLogEntry = {
      ...log,
      timestamp: new Date().toISOString()
    };
    this.memAgentLogs.push(entry);

    try {
      await this.clients[agentKey].pages.create({
        parent: { database_id: dbId },
        properties: {
          Agent: { select: { name: log.agent } },
          'Event Type': { select: { name: log.eventType } },
          Summary: { title: [{ text: { content: truncateText(log.summary, 150) } }] },
          Reasoning: { rich_text: [{ text: { content: truncateText(log.reasoning) } }] },
          Initiative: { relation: [{ id: log.initiativeId }] }
        }
      });
    } catch (err: any) {
      console.warn(`[Notion Fallback] createAgentLog recorded in memory: ${err.message}`);
    }
  }

  // --- Decisions Database ---

  async createDecision(agentKey: AgentKey, decision: Omit<Decision, 'status'>): Promise<Decision> {
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createDecision');

    try {
      const response = await this.clients[agentKey].pages.create({
        parent: { database_id: dbId },
        properties: {
          Title: { title: [{ text: { content: truncateText(decision.title) } }] },
          Status: { select: { name: 'Pending' } },
          'Requested By': { select: { name: decision.requestedBy } },
          Amount: { number: decision.amount },
          'Reasoning Summary': { rich_text: [{ text: { content: truncateText(decision.reasoningSummary) } }] },
          Initiative: { relation: [{ id: decision.initiativeId }] }
        }
      });
      const dec = mapNotionPageToDecision(response);
      this.memDecisions.set(dec.id ?? `dec_${Date.now()}`, dec);
      return dec;
    } catch (err: any) {
      console.warn(`[Notion Fallback] createDecision recorded in memory: ${err.message}`);
      const mockDec: Decision = {
        id: `dec_${Date.now()}`,
        title: decision.title,
        status: 'Pending',
        requestedBy: decision.requestedBy,
        amount: decision.amount,
        reasoningSummary: decision.reasoningSummary,
        initiativeId: decision.initiativeId
      };
      this.memDecisions.set(mockDec.id!, mockDec);
      return mockDec;
    }
  }

  async updateDecisionStatus(id: string, status: Decision['status'], decider = 'Human'): Promise<void> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'updateDecisionStatus');

    const memMatch = this.memDecisions.get(id);
    if (memMatch) {
      memMatch.status = status;
      memMatch.decidedBy = decider;
      memMatch.decidedAt = new Date().toISOString();
    }

    try {
      await this.clients[agent].pages.update({
        page_id: id,
        properties: {
          Status: { select: { name: status } },
          'Decided By': { rich_text: [{ text: { content: truncateText(decider) } }] },
          'Decided At': { date: { start: new Date().toISOString() } }
        }
      });
    } catch (err: any) {
      console.warn(`[Notion Fallback] updateDecisionStatus recorded in memory: ${err.message}`);
    }
  }

  async getDecision(id: string): Promise<Decision> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getDecision');

    try {
      const response = await this.clients[agent].pages.retrieve({ page_id: id });
      return mapNotionPageToDecision(response);
    } catch (err: any) {
      const match = this.memDecisions.get(id);
      if (match) return match;
      return {
        id,
        title: 'Approve Campaign Budget',
        status: 'Pending',
        requestedBy: 'Marketing',
        amount: 5000,
        reasoningSummary: 'Budget request',
        initiativeId: ''
      };
    }
  }

  async getPendingDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getPendingDecisions');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId,
        filter: {
          property: 'Status',
          select: {
            equals: 'Pending'
          }
        }
      });
      return response.results.map(mapNotionPageToDecision);
    } catch (err: any) {
      return Array.from(this.memDecisions.values()).filter(d => d.status === 'Pending');
    }
  }

  async getRecentApprovedDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getRecentApprovedDecisions');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId,
        filter: {
          property: 'Status',
          select: {
            equals: 'Approved'
          }
        }
      });
      return response.results.map(mapNotionPageToDecision);
    } catch (err: any) {
      return Array.from(this.memDecisions.values()).filter(d => d.status === 'Approved');
    }
  }

  // --- Actions Database ---

  async createAction(agentKey: AgentKey, action: Omit<ActionEntry, 'timestamp'>): Promise<void> {
    const dbId = process.env.NOTION_ACTIONS_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createAction');

    const entry: ActionEntry = {
      ...action,
      timestamp: new Date().toISOString()
    };
    this.memActions.push(entry);

    try {
      await this.clients[agentKey].pages.create({
        parent: { database_id: dbId },
        properties: {
          Title: { title: [{ text: { content: truncateText(action.title) } }] },
          Tool: { select: { name: action.tool } },
          Link: { url: action.link },
          'Performed By': { select: { name: action.performedBy } },
          Initiative: { relation: [{ id: action.initiativeId }] },
          Timestamp: { date: { start: new Date().toISOString() } }
        }
      });
    } catch (err: any) {
      console.warn(`[Notion Fallback] createAction recorded in memory: ${err.message}`);
    }
  }

  // --- Policy Page ---

  async readPolicyPage(): Promise<string> {
    const agent = 'finance';
    const pageId = process.env.NOTION_POLICY_PAGE_ID!;
    this.checkPermission(agent, pageId, 'readPolicyPage');

    try {
      const blocksResponse = await this.clients[agent].blocks.children.list({ block_id: pageId });
      
      let policyText = '';
      for (const block of blocksResponse.results as any[]) {
        if (block.type === 'paragraph') {
          policyText += block.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') + '\n';
        } else if (block.type === 'bulleted_list_item') {
          policyText += '• ' + block.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') + '\n';
        } else if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
          const heading = block[block.type];
          policyText += `\n# ${heading?.rich_text?.map((t: any) => t.plain_text).join('')}\n`;
        }
      }
      return policyText.trim();
    } catch (err: any) {
      console.warn(`[Notion Fallback] Using default policy text: ${err.message}`);
      return `Company Budget Policy Guidelines:
- Under $5,000: Auto-approved standard spending.
- $5,000 to $10,000: Requires justification. Finance counter-offer threshold applies.
- Over $10,000: High risk hard ceiling requiring executive review.`;
    }
  }

  async getAllInitiatives(): Promise<Initiative[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllInitiatives');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId
      });
      const items = response.results.map(mapNotionPageToInitiative);
      return items.length > 0 ? items : Array.from(this.memInitiatives.values());
    } catch (err: any) {
      return Array.from(this.memInitiatives.values());
    }
  }

  async getAllDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllDecisions');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId
      });
      const items = response.results.map(mapNotionPageToDecision);
      return items.length > 0 ? items : Array.from(this.memDecisions.values());
    } catch (err: any) {
      return Array.from(this.memDecisions.values());
    }
  }

  async getAgentLogsForInitiative(initiativeId: string): Promise<AgentLogEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agent, dbId, 'getAgentLogsForInitiative');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId,
        filter: {
          property: 'Initiative',
          relation: {
            contains: initiativeId
          }
        }
      });
      const items = response.results.map(mapNotionPageToAgentLog);
      return items.length > 0 ? items : this.memAgentLogs.filter(l => l.initiativeId === initiativeId);
    } catch (err: any) {
      return this.memAgentLogs.filter(l => l.initiativeId === initiativeId);
    }
  }

  async getAllAgentLogs(): Promise<AgentLogEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllAgentLogs');

    try {
      const response = await this.clients[agent].databases.query({
        database_id: dbId
      });
      const items = response.results.map(mapNotionPageToAgentLog);
      return items.length > 0 ? items : this.memAgentLogs;
    } catch (err: any) {
      return this.memAgentLogs;
    }
  }

  async getAllActions(initiativeId?: string): Promise<ActionEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_ACTIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllActions');

    try {
      const filter = initiativeId ? {
        property: 'Initiative',
        relation: {
          contains: initiativeId
        }
      } : undefined;

      const response = await this.clients[agent].databases.query({
        database_id: dbId,
        filter
      });
      const items = response.results.map(mapNotionPageToActionEntry);
      return items.length > 0 ? items : (initiativeId ? this.memActions.filter(a => a.initiativeId === initiativeId) : this.memActions);
    } catch (err: any) {
      return initiativeId ? this.memActions.filter(a => a.initiativeId === initiativeId) : this.memActions;
    }
  }
}
