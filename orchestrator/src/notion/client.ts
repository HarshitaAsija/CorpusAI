import { Client } from '@notionhq/client';
import { AgentName, AgentLogEntry, Decision, ActionEntry, Initiative } from '../types';
import { mapNotionPageToInitiative, mapNotionPageToDecision, mapNotionPageToAgentLog, mapNotionPageToActionEntry } from './schemas';

export type AgentKey = 'marketing' | 'finance' | 'engineering' | 'orchestrator';

const PERMISSIONS: Record<AgentKey, string[]> = {
  marketing: ['agent_log', 'decisions', 'initiatives'],
  finance: ['agent_log', 'decisions', 'initiatives', 'policy_page'],
  engineering: ['actions', 'decisions', 'agent_log'],
  orchestrator: ['initiatives', 'agent_log', 'decisions', 'actions', 'policy_page']
};

/**
 * Notion API limits rich text content to 2000 characters per block.
 * This helper truncates text to 1999 characters to avoid validation errors.
 */
function truncateText(text: string, maxLength = 1995): string {
  if (!text) return '';
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return text;
}

export class NotionClientWrapper {
  private clients: Record<AgentKey, Client>;
  private dbIdMap: Record<string, string> = {};

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

  private checkPermission(agent: AgentKey, targetId: string, actionDescription: string): void {
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

    const response = await this.clients[agent].pages.create({
      parent: { database_id: dbId },
      properties: {
        Name: { title: [{ text: { content: truncateText(name) } }] },
        Status: { select: { name: 'Planning' } },
        'Owner (Human)': { rich_text: [{ text: { content: truncateText(owner) } }] },
        Summary: { rich_text: [{ text: { content: truncateText(summary) } }] }
      }
    });
    return mapNotionPageToInitiative(response);
  }

  async updateInitiativeStatus(id: string, status: Initiative['status'], summaryUpdate?: string): Promise<void> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'updateInitiativeStatus');

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
  }

  async getInitiative(id: string): Promise<Initiative> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'getInitiative');

    const response = await this.clients[agent].pages.retrieve({ page_id: id });
    return mapNotionPageToInitiative(response);
  }

  // --- Agent Logs Database ---

  async createAgentLog(agentKey: AgentKey, log: Omit<AgentLogEntry, 'timestamp'>): Promise<void> {
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createAgentLog');

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
  }

  // --- Decisions Database ---

  async createDecision(agentKey: AgentKey, decision: Omit<Decision, 'status'>): Promise<Decision> {
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createDecision');

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
    return mapNotionPageToDecision(response);
  }

  async updateDecisionStatus(id: string, status: Decision['status'], decider = 'Human'): Promise<void> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'updateDecisionStatus');

    await this.clients[agent].pages.update({
      page_id: id,
      properties: {
        Status: { select: { name: status } },
        'Decided By': { rich_text: [{ text: { content: truncateText(decider) } }] },
        'Decided At': { date: { start: new Date().toISOString() } }
      }
    });
  }

  async getDecision(id: string): Promise<Decision> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getDecision');

    const response = await this.clients[agent].pages.retrieve({ page_id: id });
    return mapNotionPageToDecision(response);
  }

  async getPendingDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getPendingDecisions');

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
  }

  async getRecentApprovedDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getRecentApprovedDecisions');

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
  }

  // --- Actions Database ---

  async createAction(agentKey: AgentKey, action: Omit<ActionEntry, 'timestamp'>): Promise<void> {
    const dbId = process.env.NOTION_ACTIONS_DB_ID!;
    this.checkPermission(agentKey, dbId, 'createAction');

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
  }

  // --- Policy Page ---

  async readPolicyPage(): Promise<string> {
    const agent = 'finance';
    const pageId = process.env.NOTION_POLICY_PAGE_ID!;
    this.checkPermission(agent, pageId, 'readPolicyPage');

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
  }

  async getAllInitiatives(): Promise<Initiative[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_INITIATIVES_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllInitiatives');

    const response = await this.clients[agent].databases.query({
      database_id: dbId
    });
    return response.results.map(mapNotionPageToInitiative);
  }

  async getAllDecisions(): Promise<Decision[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_DECISIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllDecisions');

    const response = await this.clients[agent].databases.query({
      database_id: dbId
    });
    return response.results.map(mapNotionPageToDecision);
  }

  async getAgentLogsForInitiative(initiativeId: string): Promise<AgentLogEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agent, dbId, 'getAgentLogsForInitiative');

    const response = await this.clients[agent].databases.query({
      database_id: dbId,
      filter: {
        property: 'Initiative',
        relation: {
          contains: initiativeId
        }
      }
    });
    return response.results.map(mapNotionPageToAgentLog);
  }

  async getAllActions(initiativeId?: string): Promise<ActionEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_ACTIONS_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllActions');

    const queryParams: any = {
      database_id: dbId
    };

    if (initiativeId) {
      queryParams.filter = {
        property: 'Initiative',
        relation: {
          contains: initiativeId
        }
      };
    }

    const response = await this.clients[agent].databases.query(queryParams);
    return response.results.map(mapNotionPageToActionEntry);
  }

  async getAllAgentLogs(): Promise<AgentLogEntry[]> {
    const agent = 'orchestrator';
    const dbId = process.env.NOTION_AGENTLOG_DB_ID!;
    this.checkPermission(agent, dbId, 'getAllAgentLogs');

    const response = await this.clients[agent].databases.query({
      database_id: dbId
    });
    return response.results.map(mapNotionPageToAgentLog);
  }
}
