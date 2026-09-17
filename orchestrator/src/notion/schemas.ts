import { Initiative, Decision, ActionEntry, AgentLogEntry, AgentName, EventType } from '../types';

export function getTitle(property: any): string {
  return property?.title?.map((t: any) => t.plain_text).join('') || '';
}

export function getRichText(property: any): string {
  return property?.rich_text?.map((t: any) => t.plain_text).join('') || '';
}

export function getSelect(property: any): string {
  return property?.select?.name || '';
}

export function getNumber(property: any): number {
  return property?.number || 0;
}

export function getRelation(property: any): string[] {
  return property?.relation?.map((r: any) => r.id) || [];
}

export function getDate(property: any): string {
  return property?.date?.start || '';
}

export function getCreatedTime(property: any): string {
  return property?.created_time || '';
}

export function mapNotionPageToInitiative(page: any): Initiative {
  return {
    id: page.id,
    name: getTitle(page.properties.Name),
    status: getSelect(page.properties.Status) as any,
    owner: getRichText(page.properties['Owner (Human)']),
    created: getCreatedTime(page.properties.Created),
    summary: getRichText(page.properties.Summary),
    linkedDecisions: getRelation(page.properties['Linked Decisions']),
    linkedActions: getRelation(page.properties['Linked Actions'])
  };
}

export function mapNotionPageToDecision(page: any): Decision {
  return {
    id: page.id,
    title: getTitle(page.properties.Title),
    status: getSelect(page.properties.Status) as any,
    requestedBy: getSelect(page.properties['Requested By']) as AgentName,
    amount: getNumber(page.properties.Amount),
    reasoningSummary: getRichText(page.properties['Reasoning Summary']),
    initiativeId: getRelation(page.properties.Initiative)[0] || '',
    decidedBy: getRichText(page.properties['Decided By']),
    decidedAt: getDate(page.properties['Decided At'])
  };
}

export function mapNotionPageToAgentLog(page: any): AgentLogEntry {
  return {
    id: page.id,
    timestamp: getCreatedTime(page.properties.Timestamp),
    agent: getSelect(page.properties.Agent) as AgentName,
    eventType: getSelect(page.properties['Event Type']) as EventType,
    summary: getTitle(page.properties.Summary),
    reasoning: getRichText(page.properties.Reasoning),
    initiativeId: getRelation(page.properties.Initiative)[0] || ''
  };
}

export function getUrl(property: any): string {
  return property?.url || '';
}

export function mapNotionPageToActionEntry(page: any): ActionEntry {
  return {
    id: page.id,
    title: getTitle(page.properties.Title),
    tool: getSelect(page.properties.Tool) as any,
    link: getUrl(page.properties.Link),
    performedBy: getSelect(page.properties['Performed By']) as AgentName,
    initiativeId: getRelation(page.properties.Initiative)[0] || '',
    timestamp: getDate(page.properties.Timestamp) || page.created_time || ''
  };
}

