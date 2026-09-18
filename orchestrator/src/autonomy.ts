import { cogneeClient } from './memory/cogneeClient';

export interface RiskAssessment {
  risk: 'Low' | 'Medium' | 'High';
  reason: string;
  matchedVia?: 'rule_based' | 'cognee_graph' | 'cognee_rag' | 'cognee_hybrid' | 'fallback' | 'none';
  relevanceScore?: number;
}

export class AdaptiveAutonomyEngine {
  private storage: any;

  constructor(storage: any) {
    this.storage = storage;
  }

  /**
   * Assesses the risk of a new decision based on historical approvals and Cognee memory.
   * Fast path: 15% budget variance against historical approvals ([RULE-BASED]).
   * Semantic path: Cognee Knowledge Graph precedent search ([COGNEE-ASSISTED]) with match quality thresholding.
   */
  async assessRisk(amount: number, category: string, justification = ''): Promise<RiskAssessment> {
    console.log(`[Autonomy Engine] Assessing risk for amount $${amount} (Category: ${category})...`);

    try {
      // 1. Fast-path: check recently approved decisions in storage
      const approvedDecisions = await this.storage.getRecentApprovedDecisions();
      console.log(`[Autonomy Engine] Found ${approvedDecisions.length} historical approved decisions to evaluate.`);

      if (approvedDecisions.length > 0) {
        for (const dec of approvedDecisions) {
          const histAmount = dec.amount;
          if (histAmount > 0) {
            const variance = Math.abs(histAmount - amount) / histAmount;
            if (variance <= 0.15) {
              const percentage = (variance * 100).toFixed(1);
              const reason = `[RULE-BASED] Auto-approved under established policy. Matches approved decision "${dec.title}" ($${histAmount}) within ${percentage}% variance (threshold is 15%).`;
              console.log(`[Autonomy Engine] Rule match found! ${reason}`);
              return {
                risk: 'Low',
                reason,
                matchedVia: 'rule_based'
              };
            }
          }
        }
      }

      // 2. Semantic-path: Query Cognee Knowledge Graph memory for precedent
      console.log(`[Autonomy Engine] No direct 15% variance match. Consulting Cognee Knowledge Graph memory...`);
      const precedentResult = await cogneeClient.queryPrecedent(amount, justification, category);

      if (precedentResult.available && precedentResult.precedents.length > 0) {
        const scoreLabel = precedentResult.relevanceScore.toFixed(2);
        const confidenceLabel = precedentResult.confidence;

        // Auto-approve ONLY if amount <= $8000 AND precedent match is strong (score >= 0.70 / High Confidence)
        if (amount <= 8000 && (precedentResult.relevanceScore >= 0.70 || precedentResult.confidence === 'High')) {
          const reason = `[COGNEE-ASSISTED] Match Score: ${scoreLabel}/1.0 (${confidenceLabel} Confidence). Auto-approved via Cognee semantic memory: Historical precedent found in knowledge graph for ${category} budget request. Precedent context: ${precedentResult.summary}`;
          console.log(`[Autonomy Engine] Cognee high-confidence match approved! ${reason}`);
          return {
            risk: 'Low',
            reason,
            matchedVia: precedentResult.matchedVia,
            relevanceScore: precedentResult.relevanceScore
          };
        } else if (amount <= 8000) {
          // Amount is low but precedent score is inadequate (< 0.70)
          const reason = `[COGNEE-ASSISTED] Match Score: ${scoreLabel}/1.0 (${confidenceLabel} Confidence). Precedent match score is below semantic auto-approval threshold (0.70). Requiring human sign-off despite amount ($${amount}) being below ceiling. Context: ${precedentResult.summary}`;
          console.log(`[Autonomy Engine] Cognee low-confidence match rejected for auto-approval: ${reason}`);
          return {
            risk: 'Medium',
            reason,
            matchedVia: precedentResult.matchedVia,
            relevanceScore: precedentResult.relevanceScore
          };
        } else {
          // Precedent found but amount exceeds autonomous dollar ceiling ($8000)
          const reason = `[COGNEE-ASSISTED] Match Score: ${scoreLabel}/1.0 (${confidenceLabel} Confidence). Cognee knowledge graph precedent retrieved (${precedentResult.summary}), but requested amount ($${amount}) exceeds autonomous dollar threshold ($8000). Requiring human sign-off.`;
          console.log(`[Autonomy Engine] Cognee precedent retrieved with Medium risk due to budget ceiling: ${reason}`);
          return {
            risk: 'Medium',
            reason,
            matchedVia: precedentResult.matchedVia,
            relevanceScore: precedentResult.relevanceScore
          };
        }
      }

      // 3. Fallback: standard rule-based default
      return {
        risk: 'Medium',
        reason: `[RULE-BASED] No matching approved decision found within 15% budget variance of $${amount}.`,
        matchedVia: 'rule_based'
      };

    } catch (error) {
      console.error('[Autonomy Engine] Failed to assess risk, defaulting to High risk:', error);
      return {
        risk: 'High',
        reason: `[RULE-BASED] Autonomy engine assessment fallback: ${error instanceof Error ? error.message : String(error)}`,
        matchedVia: 'fallback'
      };
    }
  }
}
