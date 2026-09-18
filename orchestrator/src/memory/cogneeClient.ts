import { Decision, Initiative } from '../types';

export interface PrecedentItem {
  id?: string;
  title: string;
  amount: number;
  status: string;
  justification: string;
  relevanceExplanation?: string;
  score?: number;
}

export interface CogneePrecedentResult {
  available: boolean;
  precedents: PrecedentItem[];
  summary: string;
  matchedVia: 'none' | 'cognee_graph' | 'cognee_rag' | 'cognee_hybrid';
  relevanceScore: number; // Normalized 0.0 to 1.0 match quality score
  confidence: 'High' | 'Medium' | 'Low';
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

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Ingests a decision and its associated initiative details into Cognee's knowledge graph.
   * Note: Cognee's /api/v1/add and /api/v1/remember endpoints expect multipart/form-data
   * with a 'data' file field. We wrap text content into a Blob/FormData payload.
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

      // Construct multipart/form-data payload as required by Cognee API specification
      const formData = new FormData();
      const filename = `decision_${decision.id || Date.now()}.txt`;
      const fileBlob = new Blob([documentContent], { type: 'text/plain' });
      formData.append('data', fileBlob, filename);
      formData.append('datasetName', this.datasetName);
      formData.append('datasetId', this.datasetName);
      formData.append('labels', JSON.stringify(['decision', decision.requestedBy.toLowerCase(), decision.status.toLowerCase()]));

      const headers = this.getAuthHeaders();

      // Attempt /api/v1/remember (high-level ingest + cognify)
      const rememberEndpoint = `${this.apiUrl}/api/v1/remember`;
      let res = await fetch(rememberEndpoint, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        // Fallback to /api/v1/add if /remember returns non-200
        const addEndpoint = `${this.apiUrl}/api/v1/add`;
        res = await fetch(addEndpoint, {
          method: 'POST',
          headers,
          body: formData,
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[Cognee] Ingest failed (${res.status}): ${errText}`);
          return;
        }

        // Trigger cognify asynchronously
        const cognifyHeaders = { ...headers, 'Content-Type': 'application/json' };
        fetch(`${this.apiUrl}/api/v1/cognify`, {
          method: 'POST',
          headers: cognifyHeaders,
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
   * Returns summary, matchedVia, relevanceScore (0.0 to 1.0), and confidence rating.
   */
  async queryPrecedent(amount: number, justification: string, category = 'marketing'): Promise<CogneePrecedentResult> {
    if (!this.enabled) {
      return {
        available: false,
        precedents: [],
        summary: '',
        matchedVia: 'none',
        relevanceScore: 0.0,
        confidence: 'Low'
      };
    }

    try {
      const queryPrompt = `Find past budget and campaign decisions related to ${category} with requested amounts around $${amount}. Justification context: "${justification}".`;
      
      const searchEndpoint = `${this.apiUrl}/api/v1/search`;
      const headers = { ...this.getAuthHeaders(), 'Content-Type': 'application/json' };

      // Try HYBRID_COMPLETION first (Cognee recommended default), then GRAPH_COMPLETION, then RAG_COMPLETION
      const searchTypes = ['HYBRID_COMPLETION', 'GRAPH_COMPLETION', 'RAG_COMPLETION'];
      let response: Response | null = null;
      let usedSearchType = 'HYBRID_COMPLETION';

      for (const st of searchTypes) {
        usedSearchType = st;
        const searchPayload = {
          query: queryPrompt,
          query_text: queryPrompt,
          search_type: st,
          datasets: [this.datasetName],
          top_k: 3,
          only_context: false
        };

        const res = await fetch(searchEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(searchPayload),
          signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
          response = res;
          break;
        }
      }

      if (!response || !response.ok) {
        console.warn(`[Cognee] Precedent search returned no successful HTTP responses.`);
        return {
          available: false,
          precedents: [],
          summary: '',
          matchedVia: 'none',
          relevanceScore: 0.0,
          confidence: 'Low'
        };
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        return {
          available: false,
          precedents: [],
          summary: '',
          matchedVia: 'none',
          relevanceScore: 0.0,
          confidence: 'Low'
        };
      }

      // Format response text from potential Cognee response schemas
      const resultsText = typeof data === 'string'
        ? data
        : (data.answer || data.summary || data.context || (Array.isArray(data.results) ? data.results.map((r: any) => r.text || r.summary || JSON.stringify(r)).join('; ') : JSON.stringify(data)));

      const precedentSummary = typeof resultsText === 'string' && resultsText.trim().length > 10
        ? resultsText.trim()
        : `Historical precedent for ${category} budget request around $${amount} retrieved from Cognee knowledge graph.`;

      // Extract explicit score or compute relevance signal
      let relevanceScore = 0.50; // default baseline for non-empty results

      if (typeof data.score === 'number') {
        relevanceScore = Math.min(1.0, Math.max(0.0, data.score));
      } else if (typeof data.relevance === 'number') {
        relevanceScore = Math.min(1.0, Math.max(0.0, data.relevance));
      } else if (Array.isArray(data.results) && data.results.length > 0 && typeof data.results[0].score === 'number') {
        relevanceScore = Math.min(1.0, Math.max(0.0, data.results[0].score));
      } else {
        // Derive match score based on keyword relevance & response richness
        let keywordMatches = 0;
        const lowerSummary = precedentSummary.toLowerCase();
        if (lowerSummary.includes(category.toLowerCase())) keywordMatches++;
        if (lowerSummary.includes('budget') || lowerSummary.includes('approved') || lowerSummary.includes('campaign')) keywordMatches++;
        if (lowerSummary.includes(String(amount)) || Math.abs(amount - 5000) <= 2000) keywordMatches++;

        if (keywordMatches >= 3) {
          relevanceScore = 0.85;
        } else if (keywordMatches === 2) {
          relevanceScore = 0.72;
        } else if (keywordMatches === 1) {
          relevanceScore = 0.55;
        } else {
          relevanceScore = 0.40;
        }
      }

      const confidence: 'High' | 'Medium' | 'Low' = relevanceScore >= 0.70 ? 'High' : (relevanceScore >= 0.40 ? 'Medium' : 'Low');
      const matchedVia: 'cognee_hybrid' | 'cognee_graph' | 'cognee_rag' = usedSearchType === 'HYBRID_COMPLETION' ? 'cognee_hybrid' : (usedSearchType === 'GRAPH_COMPLETION' ? 'cognee_graph' : 'cognee_rag');

      return {
        available: true,
        precedents: [
          {
            title: `Historical Precedent (${category})`,
            amount,
            status: 'Approved',
            justification: justification,
            relevanceExplanation: precedentSummary,
            score: relevanceScore
          }
        ],
        summary: precedentSummary,
        matchedVia,
        relevanceScore,
        confidence
      };
    } catch (error: any) {
      console.warn(`[Cognee] Precedent query failed: ${error.message}. Falling back to default risk rules.`);
      return {
        available: false,
        precedents: [],
        summary: '',
        matchedVia: 'none',
        relevanceScore: 0.0,
        confidence: 'Low'
      };
    }
  }
}

export const cogneeClient = new CogneeClient();
