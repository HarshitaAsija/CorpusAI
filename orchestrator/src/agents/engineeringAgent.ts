import { OpenAI } from 'openai';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface EngineeringResponse {
  title: string;
  body: string;
}

export class EngineeringAgent {
  private openai: OpenAI;
  private model = process.env.NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY || 'nvapi-placeholder-key',
      baseURL: 'https://integrate.api.nvidia.com/v1'
    });
  }

  /**
   * Generates a GitHub issue title and body for the approved campaign.
   */
  async planDeliverables(
    campaignPlan: string,
    approvedBudget: number,
    justification: string,
    retries = 3
  ): Promise<EngineeringResponse> {
    const isPlaceholder = !process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY.startsWith('nvapi-placeholder');

    if (!isPlaceholder) {
      const prompt = `You are the Engineering Lead. A marketing initiative has been approved:
- Campaign Plan: "${campaignPlan}"
- Approved Budget: $${approvedBudget}
- Campaign Justification: "${justification}"

You must create a GitHub issue spec describing the technical deliverable (e.g., landing page, tracking setup, database integrations) needed to support this campaign.
Include clear acceptance criteria.

You MUST respond with a valid JSON object matching this schema:
{
  "title": "A concise GitHub issue title (e.g. [FE] Build landing page for X campaign)",
  "body": "Markdown formatted description containing details, tasks, and acceptance criteria."
}`;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: 'You are an engineering manager. You always respond in raw JSON.' },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2
          });

          const jsonText = response.choices[0]?.message?.content || '{}';
          const data = JSON.parse(jsonText) as EngineeringResponse;

          if (typeof data.title === 'string' && typeof data.body === 'string') {
            return data;
          }
        } catch (error: any) {
          console.warn(`[Engineering Agent] Attempt ${attempt} failed: ${error.message}`);
          await delay(500 * attempt);
        }
      }
    }

    console.log('[Engineering Agent] Using robust fallback deliverable plan.');
    return {
      title: `[FE/BE] Technical Deliverables: Launch growth campaign infrastructure`,
      body: `### Deliverable Specification\nBuild marketing landing page, tracking telemetry, and automated lead capture hooks.\n\n- **Approved Budget:** $${approvedBudget}\n- **Campaign Plan:** ${campaignPlan}\n- **Justification:** ${justification}\n\n### Acceptance Criteria\n1. High-speed responsive landing page deployed\n2. Real-time conversion tracking webhooks integrated\n3. Verification test suite passing`
    };
  }
}
