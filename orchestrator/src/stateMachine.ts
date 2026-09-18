import { IStorageClient } from './storage/storageInterface';
import { getStorageClient } from './storage';
import { cogneeClient } from './memory/cogneeClient';
import { FSMState, Initiative, Decision } from './types';
import { MarketingAgent, CampaignProposal } from './agents/marketingAgent';
import { FinanceAgent } from './agents/financeAgent';
import { EngineeringAgent } from './agents/engineeringAgent';
import { AdaptiveAutonomyEngine } from './autonomy';
import { createGitHubIssue } from './integrations/github';
import { postSlackMessage } from './integrations/slack';

// CRITICAL: processingInitiatives is in-memory only and will NOT survive a server restart. 
// If the server restarts mid-flight, the active locks are lost. Do not restart the server during a demo run.
export const processingInitiatives = new Map<string, boolean>();

export class OrchestratorFSM {
  private notion: IStorageClient;
  private marketing: MarketingAgent;
  private finance: FinanceAgent;
  private engineering: EngineeringAgent;
  private autonomy: AdaptiveAutonomyEngine;
  private onEvent?: (event: any) => void;

  constructor(onEvent?: (event: any) => void, storage?: IStorageClient) {
    this.onEvent = onEvent;
    this.notion = storage || getStorageClient();

    // Intercept createAgentLog to broadcast websocket event
    const originalCreateAgentLog = this.notion.createAgentLog.bind(this.notion);
    this.notion.createAgentLog = async (agentKey: any, log: any) => {
      await originalCreateAgentLog(agentKey, log);
      if (this.onEvent) {
        this.onEvent({
          type: 'fsm-update',
          initiativeId: log.initiativeId,
          eventType: 'log',
          log: {
            ...log,
            timestamp: new Date().toISOString()
          }
        });
      }
    };

    // Intercept updateInitiativeStatus to broadcast websocket event
    const originalUpdateStatus = this.notion.updateInitiativeStatus.bind(this.notion);
    this.notion.updateInitiativeStatus = async (id: string, status: any, summaryUpdate?: string) => {
      await originalUpdateStatus(id, status, summaryUpdate);
      if (this.onEvent) {
        this.onEvent({
          type: 'fsm-update',
          initiativeId: id,
          eventType: 'status_update',
          status,
          summary: summaryUpdate
        });
      }
    };

    this.marketing = new MarketingAgent();
    this.finance = new FinanceAgent();
    this.engineering = new EngineeringAgent();
    this.autonomy = new AdaptiveAutonomyEngine(this.notion);
  }

  /**
   * Kicks off or resumes the state machine for an initiative.
   */
  async run(initiativeId: string, customGoal?: string): Promise<void> {
    const cleanId = initiativeId.replace(/-/g, '').toLowerCase();

    // Prevent duplicate processing ticks (lock check)
    if (processingInitiatives.get(cleanId)) {
      console.log(`[FSM] Initiative ${initiativeId} is already being processed. Skipping double trigger.`);
      return;
    }

    try {
      processingInitiatives.set(cleanId, true);
      console.log(`[FSM] Starting/Resuming FSM for Initiative: ${initiativeId}`);

      // Retrieve current state from Notion
      const initiative = await this.notion.getInitiative(initiativeId);
      console.log(`[FSM] Current status: ${initiative.status}`);

      // Route based on current initiative status
      switch (initiative.status) {
        case 'Planning':
          await this.handlePlanningState(initiative, customGoal || initiative.name);
          break;
        case 'Awaiting Approval':
          await this.handleAwaitingApprovalState(initiative);
          break;
        case 'Approved':
        case 'Executing':
          await this.handleExecutingState(initiative);
          break;
        case 'Rejected':
          console.log(`[FSM] Initiative ${initiativeId} was rejected. Stopping.`);
          break;
        case 'Done':
          console.log(`[FSM] Initiative ${initiativeId} is already completed.`);
          break;
        default:
          console.log(`[FSM] Unknown status: ${initiative.status}`);
      }

    } catch (error) {
      console.error(`[FSM Error] Failures executing FSM for ${initiativeId}:`, error);
      try {
        await this.notion.createAgentLog('orchestrator', {
          agent: 'Orchestrator',
          eventType: 'Error',
          summary: `FSM Execution Error: ${error instanceof Error ? error.message : String(error)}`,
          reasoning: error instanceof Error && error.stack ? error.stack : 'No stack trace.',
          initiativeId
        });
      } catch (logErr) {
        console.error('[FSM Error] Could not write error log to Notion:', logErr);
      }
    } finally {
      // Release lock
      processingInitiatives.delete(cleanId);
      console.log(`[FSM] Released lock for Initiative: ${initiativeId}`);
    }
  }

  /**
   * Goal received -> marketing drafts initial plan -> finance reviews it -> negotiates if pushback
   */
  private async handlePlanningState(initiative: Initiative, goal: string): Promise<void> {
    console.log(`\n[FSM] --- Starting Planning state for Initiative: ${initiative.id} ---`);

    // 1. Initial Orchestrator Log
    await this.notion.createAgentLog('orchestrator', {
      agent: 'Orchestrator',
      eventType: 'Request',
      summary: `Received Company Goal: "${goal}"`,
      reasoning: 'Starting FSM. Assigning initial task to Marketing agent to draft a campaign proposal.',
      initiativeId: initiative.id
    });

    // 2. Call Marketing Agent to Draft Proposal
    console.log('[FSM] Contacting Marketing Agent to draft campaign plan...');
    const proposal = await this.marketing.draftCampaign(goal);
    
    console.log(`[FSM] Marketing proposed plan: "${proposal.campaignPlan}" with budget request: $${proposal.budgetRequest.amount}`);
    
    await this.notion.createAgentLog('marketing', {
      agent: 'Marketing',
      eventType: 'Response',
      summary: `Proposed campaign plan with budget $${proposal.budgetRequest.amount}`,
      reasoning: `Plan: ${proposal.campaignPlan}\n\nJustification: ${proposal.budgetRequest.justification}`,
      initiativeId: initiative.id
    });

    // 3. Fetch Policy and Call Finance Agent to Evaluate Budget
    console.log('[FSM] Fetching Policy Page for Finance Agent...');
    const policyDoc = await this.notion.readPolicyPage();
    
    // 3. Query Cognee for precedent and Evaluate Budget Request with Finance
    console.log('[FSM] Querying Cognee Knowledge Graph for historical precedent...');
    const precedentResult = await cogneeClient.queryPrecedent(
      proposal.budgetRequest.amount,
      proposal.budgetRequest.justification,
      'marketing'
    );

    console.log('[FSM] Contacting Finance Agent to review budget...');
    const evaluation = await this.finance.evaluateBudget(
      proposal.budgetRequest.amount,
      proposal.budgetRequest.justification,
      policyDoc,
      precedentResult.available ? precedentResult.summary : undefined
    );

    console.log(`[FSM] Finance decision: ${evaluation.decision}. Reason: ${evaluation.reason}`);

    await this.notion.createAgentLog('finance', {
      agent: 'Finance',
      eventType: 'Response',
      summary: `Evaluated budget request of $${proposal.budgetRequest.amount}: ${evaluation.decision.toUpperCase()}`,
      reasoning: evaluation.reason,
      initiativeId: initiative.id
    });

    let finalAmount = proposal.budgetRequest.amount;
    let finalReasoning = proposal.budgetRequest.justification;

    // 4. Handle Negotiation Round (Capped at exactly 1 round)
    if (evaluation.decision === 'counter' && evaluation.counterAmount !== undefined) {
      console.log('[FSM] Finance countered budget request. Initiating negotiation (CAPPED AT 1 ROUND)...');
      
      await this.notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Disagreement',
        summary: `Detected budget disagreement: requested $${proposal.budgetRequest.amount} vs countered $${evaluation.counterAmount}`,
        reasoning: `Finance pushback: "${evaluation.reason}". Routing to Marketing for 1 negotiation round.`,
        initiativeId: initiative.id
      });

      console.log('[FSM] Contacting Marketing Agent to negotiate budget counter...');
      const marketingNeg = await this.marketing.negotiateBudget(
        goal,
        proposal,
        evaluation.counterAmount,
        evaluation.reason
      );

      console.log(`[FSM] Marketing negotiation decision: ${marketingNeg.action}. Reasoning: ${marketingNeg.justification}`);

      await this.notion.createAgentLog('marketing', {
        agent: 'Marketing',
        eventType: 'Response',
        summary: `Marketing responds to counter-offer: ${marketingNeg.action === 'accept' ? 'ACCEPTED' : 'REVISED TO $' + marketingNeg.revisedBudget?.amount}`,
        reasoning: marketingNeg.justification,
        initiativeId: initiative.id
      });

      if (marketingNeg.action === 'accept') {
        finalAmount = evaluation.counterAmount;
        finalReasoning = `Accepted counter-offer of $${evaluation.counterAmount}. Marketing justification: ${marketingNeg.justification}`;
        
        await this.notion.createAgentLog('orchestrator', {
          agent: 'Orchestrator',
          eventType: 'Resolution',
          summary: `Negotiation resolved: Marketing accepted countered amount $${finalAmount}`,
          reasoning: 'Marketing and Finance have converged on the countered budget. Creating decision card.',
          initiativeId: initiative.id
        });

      } else if (marketingNeg.action === 'revise' && marketingNeg.revisedBudget) {
        console.log(`[FSM] Marketing requested a revised budget of $${marketingNeg.revisedBudget.amount}. Calling Finance for final review...`);
        
        const finalEvaluation = await this.finance.evaluateBudget(
          marketingNeg.revisedBudget.amount,
          marketingNeg.revisedBudget.justification,
          policyDoc,
          precedentResult.available ? precedentResult.summary : undefined
        );

        console.log(`[FSM] Finance final evaluation: ${finalEvaluation.decision}. Reason: ${finalEvaluation.reason}`);

        await this.notion.createAgentLog('finance', {
          agent: 'Finance',
          eventType: 'Response',
          summary: `Finance final review on revised amount $${marketingNeg.revisedBudget.amount}: ${finalEvaluation.decision.toUpperCase()}`,
          reasoning: finalEvaluation.reason,
          initiativeId: initiative.id
        });

        if (finalEvaluation.decision === 'approve') {
          finalAmount = marketingNeg.revisedBudget.amount;
          finalReasoning = marketingNeg.revisedBudget.justification;
          
          await this.notion.createAgentLog('orchestrator', {
            agent: 'Orchestrator',
            eventType: 'Resolution',
            summary: `Negotiation resolved: Finance approved revised amount $${finalAmount}`,
            reasoning: 'Finance approved the revised marketing request. Creating decision card.',
            initiativeId: initiative.id
          });
        } else {
          // If Finance still counters or rejects after round 1, we auto-escalate the final conflict to the human!
          finalAmount = finalEvaluation.counterAmount || marketingNeg.revisedBudget.amount;
          finalReasoning = `Auto-escalation fallback: Marketing and Finance remained in disagreement after 1 round. Marketing wanted $${marketingNeg.revisedBudget.amount} (Reason: ${marketingNeg.revisedBudget.justification}) and Finance countered/rejected with reason: ${finalEvaluation.reason}`;
          
          await this.notion.createAgentLog('orchestrator', {
            agent: 'Orchestrator',
            eventType: 'Disagreement',
            summary: `Negotiation unresolved after 1 round. Escalate to Human.`,
            reasoning: `Final positions: Marketing wants $${marketingNeg.revisedBudget.amount}, Finance countered/rejected with reason: "${finalEvaluation.reason}". Routing to human for final arbitrated decision card.`,
            initiativeId: initiative.id
          });
        }
      }
    } else if (evaluation.decision === 'reject') {
      console.log('[FSM] Finance rejected proposal. Transitioning directly to Rejected.');
      await this.notion.updateInitiativeStatus(initiative.id, 'Rejected', 'Rejected by Finance department.');
      return;
    } else {
      // Finance Approved initial budget
      console.log('[FSM] Finance approved the budget request directly.');
      await this.notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Resolution',
        summary: `Finance directly approved budget $${finalAmount}`,
        reasoning: 'Marketing proposal fits within budget limits. Creating decision card.',
        initiativeId: initiative.id
      });
    }

    // 5. Evaluate risk using Adaptive Autonomy Engine (Rule-based fast path + Cognee semantic precedent)
    const autonomyResult = await this.autonomy.assessRisk(finalAmount, 'marketing', finalReasoning);
    
    if (autonomyResult.risk === 'Low') {
      // Flagship differentiator: Auto-Approve Low Risk
      console.log(`[FSM] Adaptive Autonomy Engine returned LOW risk. Auto-approving budget of $${finalAmount}.`);
      
      // Write clearly-labeled log explaining why it was auto-approved
      await this.notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Resolution',
        summary: `Adaptive Autonomy: AUTO-APPROVED $${finalAmount}`,
        reasoning: autonomyResult.reason,
        initiativeId: initiative.id
      });

      // Create approved Decision directly for completeness
      const decision = await this.notion.createDecision('orchestrator', {
        title: `Approve $${finalAmount} Campaign Budget (Auto-Approved)`,
        requestedBy: 'Marketing',
        amount: finalAmount,
        reasoningSummary: `Auto-approved under established policy. Justification: ${finalReasoning}`,
        initiativeId: initiative.id
      });
      
      // Ingest into Cognee memory asynchronously
      cogneeClient.ingestDecision(decision, initiative).catch((err) =>
        console.warn(`[Cognee] Auto-approved decision ingest warning: ${err.message}`)
      );

      // Update Decision in Storage to Approved directly
      await this.notion.updateDecisionStatus(decision.id!, 'Approved', 'Autonomy Engine');

      // Update initiative status to Executing and proceed
      await this.notion.updateInitiativeStatus(initiative.id, 'Executing', `Auto-approved: ${autonomyResult.reason}`);
      
      // Chain execute directly
      await this.handleExecutingState({
        ...initiative,
        status: 'Executing'
      });

    } else {
      // Create Pending Decision card in Storage Decisions table for Human sign-off
      console.log(`[FSM] Adaptive Autonomy Engine returned ${autonomyResult.risk} risk. Creating Decision card and pausing for human approval.`);
      
      const pendingDecision = await this.notion.createDecision('marketing', {
        title: `Approve $${finalAmount} Campaign Budget`,
        requestedBy: 'Marketing',
        amount: finalAmount,
        reasoningSummary: finalReasoning,
        initiativeId: initiative.id
      });

      // If APPROVAL_BACKEND is n8n, trigger the enterprise approval workflow
      if (process.env.APPROVAL_BACKEND === 'n8n') {
        await this.dispatchN8nApprovalWebhook(initiative, pendingDecision);
      }

      // Update Initiative to Awaiting Approval
      await this.notion.updateInitiativeStatus(initiative.id, 'Awaiting Approval', `Pending human approval for budget $${finalAmount}`);
    }
  }

  /**
   * Dispatches an approval request to an n8n webhook workflow for human sign-off via Slack/Email.
   */
  private async dispatchN8nApprovalWebhook(initiative: Initiative, decision: Decision): Promise<void> {
    const webhookUrl = process.env.N8N_APPROVAL_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('[FSM] APPROVAL_BACKEND is set to n8n, but N8N_APPROVAL_WEBHOOK_URL is not configured.');
      return;
    }

    try {
      console.log(`[FSM] Dispatching human approval request to n8n webhook: ${webhookUrl}`);
      const payload = {
        decisionId: decision.id,
        initiativeId: initiative.id,
        title: decision.title,
        amount: decision.amount,
        requestedBy: decision.requestedBy,
        reasoningSummary: decision.reasoningSummary,
        callbackUrl: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/webhooks/approval`,
        secret: process.env.WEBHOOK_SHARED_SECRET || ''
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      console.log(`[FSM] n8n approval webhook dispatch responded with status: ${res.status}`);
      await this.notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Action',
        summary: `Dispatched approval workflow to n8n`,
        reasoning: `Sent decision payload ($${decision.amount}) to n8n webhook for human sign-off via Slack/Email.`,
        initiativeId: initiative.id
      });
    } catch (err: any) {
      console.error(`[FSM] Failed to dispatch n8n approval webhook: ${err.message}`);
    }
  }

  /**
   * Human approval gate check. Check if Decision is approved, then transition to Executing.
   */
  private async handleAwaitingApprovalState(initiative: Initiative): Promise<void> {
    console.log(`\n[FSM] --- Scanning approval status for Initiative: ${initiative.id} ---`);

    // Retrieve decisions related to this initiative
    const pendingDecisions = await this.notion.getPendingDecisions();
    const relatedDecisions = pendingDecisions.filter(d => d.initiativeId === initiative.id);

    // If there is still a pending decision, we continue to pause
    if (relatedDecisions.length > 0) {
      console.log(`[FSM] Initiative ${initiative.id} is still waiting for human approval on pending decisions.`);
      return;
    }

    // Check if any decision has been approved
    const approvedDecisions = await this.notion.getRecentApprovedDecisions();
    const approvedDecision = approvedDecisions.find(d => d.initiativeId === initiative.id);

    if (approvedDecision) {
      console.log(`[FSM] Found Approved decision for Initiative: ${initiative.id}. Transitioning to Executing.`);
      
      // Ingest approved decision into Cognee memory
      cogneeClient.ingestDecision(approvedDecision, initiative).catch((err) =>
        console.warn(`[Cognee] Approved decision ingest warning: ${err.message}`)
      );

      await this.notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Resolution',
        summary: 'Human approved initiative budget',
        reasoning: 'Decision card approved by human in Storage. Initiating execution of actions.',
        initiativeId: initiative.id
      });

      await this.notion.updateInitiativeStatus(initiative.id, 'Executing', 'Initiating engineering deliverables & announcements.');
      
      await this.handleExecutingState({
        ...initiative,
        status: 'Executing'
      });
    } else {
      // If not approved and not pending, it might have been rejected
      console.log(`[FSM] Decision was rejected or not found. Setting Initiative status to Rejected.`);
      await this.notion.updateInitiativeStatus(initiative.id, 'Rejected', 'Human rejected or deleted the decision.');
    }
  }

  /**
   * Executing -> Call Engineering to plan GitHub issue -> Call Marketing to post Slack announcement -> Log both Actions
   */
  private async handleExecutingState(initiative: Initiative): Promise<void> {
    console.log(`\n[FSM] --- Starting execution phase for Initiative: ${initiative.id} ---`);

    // Fetch approved details: retrieve approved decision amount and reasoning
    const approvedDecs = await this.notion.getRecentApprovedDecisions();
    const matchingDec = approvedDecs.find(d => d.initiativeId === initiative.id);
    const approvedBudget = matchingDec ? matchingDec.amount : 5000;
    const justification = matchingDec ? matchingDec.reasoningSummary : 'Approved.';

    // 1. Call Engineering Agent to Plan Technical deliverables
    console.log('[FSM] Calling Engineering Agent to design deliverables...');
    const engResponse = await this.engineering.planDeliverables(initiative.name, approvedBudget, justification);

    console.log(`[FSM] Engineering planned issue: "${engResponse.title}"`);

    await this.notion.createAgentLog('engineering', {
      agent: 'Engineering',
      eventType: 'Response',
      summary: `Planned engineering tasks for "${initiative.name}"`,
      reasoning: `Tasks:\n${engResponse.body}`,
      initiativeId: initiative.id
    });

    // 2. Perform GitHub Action & Slack Action in parallel with isolated error handling
    console.log('[FSM] Firing real-world side effects (GitHub & Slack) in parallel...');

    let githubSucceeded = false;
    let slackSucceeded = false;

    const githubPromise = (async () => {
      try {
        const issueUrl = await createGitHubIssue(engResponse.title, engResponse.body);
        console.log(`[FSM] GitHub Issue created successfully: ${issueUrl}`);
        
        await this.notion.createAction('engineering', {
          title: `GitHub Issue Created: "${engResponse.title}"`,
          tool: 'GitHub',
          link: issueUrl,
          performedBy: 'Engineering',
          initiativeId: initiative.id
        });

        await this.notion.createAgentLog('engineering', {
          agent: 'Engineering',
          eventType: 'Action',
          summary: `Created GitHub Issue for deliverables`,
          reasoning: `Issue URL: ${issueUrl}`,
          initiativeId: initiative.id
        });
        githubSucceeded = true;
      } catch (err: any) {
        console.error(`[FSM] GitHub Issue creation failed: ${err.message}`);
        await this.notion.createAgentLog('engineering', {
          agent: 'Engineering',
          eventType: 'Error',
          summary: `GitHub Action Failed: ${err.message}`,
          reasoning: `Encountered error while creating GitHub issue: ${err.stack || err.message}`,
          initiativeId: initiative.id
        });
      }
    })();

    const slackPromise = (async () => {
      try {
        const slackMessage = `🚀 *New Campaign Launched!*\n*Campaign Name*: ${initiative.name}\n*Budget*: $${approvedBudget}\n*Justification*: ${justification}\n*Plan*: The Engineering team is working on the landing page!`;
        const slackUrl = await postSlackMessage(slackMessage);
        console.log(`[FSM] Slack announcement posted successfully: ${slackUrl}`);

        await this.notion.createAction('orchestrator', {
          title: `Slack Announcement Posted`,
          tool: 'Slack',
          link: slackUrl,
          performedBy: 'Marketing',
          initiativeId: initiative.id
        });

        await this.notion.createAgentLog('marketing', {
          agent: 'Marketing',
          eventType: 'Action',
          summary: `Posted Slack announcement`,
          reasoning: `Message permalink: ${slackUrl}`,
          initiativeId: initiative.id
        });
        slackSucceeded = true;
      } catch (err: any) {
        console.error(`[FSM] Slack announcement failed: ${err.message}`);
        await this.notion.createAgentLog('marketing', {
          agent: 'Marketing',
          eventType: 'Error',
          summary: `Slack Action Failed: ${err.message}`,
          reasoning: `Encountered error while posting Slack announcement: ${err.stack || err.message}`,
          initiativeId: initiative.id
        });
      }
    })();

    // Wait for both side-effects to complete
    await Promise.all([githubPromise, slackPromise]);

    if (!githubSucceeded && !slackSucceeded) {
      throw new Error('Both GitHub and Slack executions failed. Please verify credentials in .env.');
    }

    // 3. Mark Initiative as Done
    console.log(`[FSM] Actions execution resolved. Completing Initiative: ${initiative.id}`);
    
    const executionSummary = (githubSucceeded && slackSucceeded)
      ? 'All actions (GitHub issue and Slack post) were fired and linked back to Notion. Initiative complete.'
      : (githubSucceeded
        ? 'GitHub issue was created successfully, but Slack notification encountered an error. Check Agent Logs for details.'
        : 'Slack announcement posted successfully, but GitHub issue creation encountered an error. Check Agent Logs for details.');

    await this.notion.createAgentLog('orchestrator', {
      agent: 'Orchestrator',
      eventType: 'Resolution',
      summary: 'Initiative completed execution',
      reasoning: executionSummary,
      initiativeId: initiative.id
    });

    await this.notion.updateInitiativeStatus(initiative.id, 'Done', `Initiative completed: ${executionSummary}`);
  }
}
