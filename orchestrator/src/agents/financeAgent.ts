import { OpenAI } from 'openai';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface FinanceResponse {
  decision: 'approve' | 'reject' | 'counter';
  counterAmount?: number;
  reason: string;
}

export class FinanceAgent {
  private openai: OpenAI;
  private model = 'meta/llama-3.1-70b-instruct';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1'
    });
  }

  /**
   * Evaluates a budget request against the corporate policy document.
   */
  async evaluateBudget(
    requestedAmount: number,
    justification: string,
    policyDoc: string,
    precedentContext?: string,
    retries = 3
  ): Promise<FinanceResponse> {
    const prompt = `You are the Finance Lead for our company. You enforce budget policy stringently.
Here is the current corporate budget policy:
====================
${policyDoc}
====================
${precedentContext ? `\nSimilar past decisions from company memory (Cognee Knowledge Graph):\n====================\n${precedentContext}\n====================\nUse these precedents to inform your reasoning and cite them if relevant.\n` : ''}
A request has been submitted for budget:
- Requested Amount: $${requestedAmount}
- Justification: "${justification}"

Evaluate this request.
- If it is under $5,000, you should 'approve' it.
- If it is between $5,000 and $10,000, it is a soft threshold and requires a strong, solid justification.
  - If the justification is reasonable (or supported by past precedent), you may 'approve'.
  - If the justification seems weak, you should 'counter' with a lower amount (typically $5,000) and explain why.
- If it is over $10,000, it is a hard threshold. You must 'reject' or 'counter' with a maximum of $5,000.

You MUST respond with a valid JSON object matching this schema:
{
  "decision": "approve" | "reject" | "counter",
  "counterAmount": 5000, // Include ONLY if decision is "counter"
  "reason": "A one-sentence policy-based explanation of your decision."
}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a strict, policy-enforcing finance director. You always respond in raw JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        });

        const jsonText = response.choices[0]?.message?.content || '{}';
        const data = JSON.parse(jsonText) as FinanceResponse;

        // Simple validation
        if (data.decision === 'approve' || data.decision === 'reject' || data.decision === 'counter') {
          if (data.decision === 'counter' && typeof data.counterAmount !== 'number') {
            throw new Error('Counter amount is missing or invalid.');
          }
          return data;
        }
        throw new Error('JSON response did not match the expected FinanceResponse schema');
      } catch (error: any) {
        console.warn(`[Finance Agent] Attempt ${attempt} failed: ${error.message}`);
        if (attempt === retries) {
          throw new Error(`FinanceAgent.evaluateBudget failed after ${retries} attempts: ${error.message}`);
        }
        await delay(1000 * attempt);
      }
    }
    throw new Error('Unreachable state');
  }
}
