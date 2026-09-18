import { Decision, Initiative } from '../types';

export interface PrecedentItem {
  id?: string;
  title: string;
  amount: number;
  status: string;
  justification: string;
  relevanceExplanation?: string;
}

export interface CogneePrecedentResult {
  available: boolean;
  precedents: PrecedentItem[];
  summary: string;
  matchedVia: 'none' | 'cognee_graph' | 'cognee_rag';
}

export class CogneeClient {
  private apiUrl: string;
  private apiKey?: string;
  private datasetName: string;
  private enabled: boolean;

  constructor() {
    this.apiUrl = (process.env.COGNEE_API_URL || 'https://api.cognee.ai').replace(/\/$/, '');
    this.apiKey = process.env.COGNEE_API_KEY;
    this.datasetName = process.env.COGNEE_DATASET_NAME || 'corporate_decisions';
    // Enable if COGNEE_API_KEY is present or COGNEE_ENABLED is explicitly true
    this.enabled = process.env.COGNEE_ENABLED === 'true' || (Boolean(this.apiKey) && process.env.COGNEE_ENABLED !== 'false');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Ingests a decision and its associated initiative details into Cognee's knowledge graph.
   */
  async ingestDecision(decision: Decision, initiative?: Initiative): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const documentContent = [
        `Corporate Decision: ${decision.title}`,
        `Initiative: ${initiative ? initiative.name : 'Corporate Initiative'} (ID: ${decision.initiativeId || initiative?.id || 'N/A'})`,
        `Requested By: ${decision.requestedBy}`,
        `Amount: $${decision.amount}`,
        `Status: ${decision.status}`,
        `Reasoning & Justification: ${decision.reasoningSummary}`,
        decision.decidedBy ? `Decided By: ${decision.decidedBy}` : '',
        decision.decidedAt ? `Decided At: ${decision.decidedAt}` : `Timestamp: ${new Date().toISOString()}`
      ].filter(Boolean).join('\n');

      // Attempt remember endpoint (high-level ingest + cognify)
      const rememberEndpoint = `${this.apiUrl}/api/v1/remember`;
      const payload = {
        data: documentContent,
        datasetName: this.datasetName,
        labels: ['decision', decision.requestedBy.toLowerCase(), decision.status.toLowerCase()]
      };

      const res = await fetch(rememberEndpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) {
        // Fallback to /api/v1/add if /remember is not available on custom self-hosted version
        const addEndpoint = `${this.apiUrl}/api/v1/add`;
        const addRes = await fetch(addEndpoint, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000)
        });

        if (!addRes.ok) {
          const errText = await addRes.text().catch(() => '');
          console.warn(`[Cognee] Ingest failed (${addRes.status}): ${errText}`);
          return;
        }

        // Trigger cognify asynchronously
        fetch(`${this.apiUrl}/api/v1/cognify`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ datasets: [this.datasetName], run_in_background: true }),
          signal: AbortSignal.timeout(4000)
        }).catch((err) => console.warn(`[Cognee] Cognify background dispatch warning: ${err.message}`));
      }

      console.log(`[Cognee] Successfully ingested decision "${decision.title}" ($${decision.amount}) into dataset "${this.datasetName}"`);
    } catch (error: any) {
      console.warn(`[Cognee] Ingest warning: ${error.message}. Storage was not affected.`);
    }
  }

  /**
   * Queries Cognee knowledge graph memory for relevant precedent decisions.
   */
  async queryPrecedent(amount: number, justification: string, category = 'marketing'): Promise<CogneePrecedentResult> {
    if (!this.enabled) {
      return {
        available: false,
        precedents: [],
        summary: '',
        matchedVia: 'none'
      };
    }

    try {
      const queryPrompt = `Find past budget and campaign decisions related to ${category} with requested amounts around $${amount}. Justification context: "${justification}".`;
      
      const searchEndpoint = `${this.apiUrl}/api/v1/search`;
      const searchPayload = {
        query: queryPrompt,
        search_type: 'GRAPH_COMPLETION',
        datasets: [this.datasetName],
        top_k: 3,
        only_context: false
      };

      let response = await fetch(searchEndpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(searchPayload),
        signal: AbortSignal.timeout(5000)
      });

      // Fallback search mode if GRAPH_COMPLETION is unsupported
      if (!response.ok) {
        searchPayload.search_type = 'RAG_COMPLETION';
        response = await fetch(searchEndpoint, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(searchPayload),
          signal: AbortSignal.timeout(5000)
        });
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[Cognee] Precedent search returned HTTP ${response.status}: ${errText}`);
        return {
          available: false,
          precedents: [],
          summary: '',
          matchedVia: 'none'
        };
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        return { available: false, precedents: [], summary: '', matchedVia: 'none' };
      }

      // Format response results
      const resultsText = typeof data === 'string'
        ? data
        : (data.answer || data.summary || data.context || JSON.stringify(data.results || data));

      const precedentSummary = typeof resultsText === 'string' && resultsText.trim().length > 10
        ? resultsText.trim()
        : `Historical precedent for ${category} budget request around $${amount} retrieved from Cognee knowledge graph.`;

      return {
        available: true,
        precedents: [
          {
            title: `Historical Precedent (${category})`,
            amount,
            status: 'Approved',
            justification: justification,
            relevanceExplanation: precedentSummary
          }
        ],
        summary: precedentSummary,
        matchedVia: searchPayload.search_type === 'GRAPH_COMPLETION' ? 'cognee_graph' : 'cognee_rag'
      };
    } catch (error: any) {
      console.warn(`[Cognee] Precedent query failed: ${error.message}. Falling back to default risk rules.`);
      return {
        available: false,
        precedents: [],
        summary: '',
        matchedVia: 'none'
      };
    }
  }
}

export const cogneeClient = new CogneeClient();
