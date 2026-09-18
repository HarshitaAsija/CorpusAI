import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { cogneeClient } from '../memory/cogneeClient';
import { NotionClientWrapper } from '../notion/client';
import { Decision, Initiative } from '../types';

async function backfill() {
  console.log('\n=============================================');
  console.log('       CorpusAI — Cognee Memory Backfill     ');
  console.log('=============================================\n');

  if (!cogneeClient.isEnabled()) {
    console.warn('[Cognee Backfill] COGNEE_API_KEY is missing or COGNEE_ENABLED is false.');
    console.warn('Set COGNEE_API_KEY=... in your .env file to run backfill.');
    process.exit(1);
  }

  const notion = new NotionClientWrapper();

  console.log('[Cognee Backfill] Fetching existing decisions and initiatives from storage...');
  let decisions: Decision[] = [];
  let initiatives: Initiative[] = [];

  try {
    decisions = await notion.getAllDecisions();
    initiatives = await notion.getAllInitiatives();
    console.log(`[Cognee Backfill] Found ${decisions.length} decisions and ${initiatives.length} initiatives in storage.`);
  } catch (err: any) {
    console.warn(`[Cognee Backfill] Could not fetch from primary storage (${err.message}). Using corporate baseline seeds.`);
  }

  // If storage is empty (fresh environment), provide foundational corporate precedents
  if (decisions.length === 0) {
    console.log('[Cognee Backfill] Storage is empty. Seeding foundational corporate precedents into Cognee...');
    decisions = [
      {
        id: 'seed-dec-1',
        title: 'Approve $5,000 Campaign Budget (Auto-Approved)',
        status: 'Approved',
        requestedBy: 'Marketing',
        amount: 5000,
        reasoningSummary: 'Q1 feature awareness launch across developer channels. Fits policy threshold.',
        initiativeId: 'seed-init-1',
        decidedBy: 'Autonomy Engine',
        decidedAt: new Date(Date.now() - 30 * 86400000).toISOString()
      },
      {
        id: 'seed-dec-2',
        title: 'Approve $6,500 Enterprise Product Hunt Sprint',
        status: 'Approved',
        requestedBy: 'Marketing',
        amount: 6500,
        reasoningSummary: 'Co-marketing sprint with key integration partners. Justification provided high expected ROI.',
        initiativeId: 'seed-init-2',
        decidedBy: 'Human Director',
        decidedAt: new Date(Date.now() - 14 * 86400000).toISOString()
      },
      {
        id: 'seed-dec-3',
        title: 'Reject $14,000 Unbudgeted Billboard Campaign',
        status: 'Rejected',
        requestedBy: 'Marketing',
        amount: 14000,
        reasoningSummary: 'Request exceeds hard company ceiling of $10,000. Counter-offered at $5,000.',
        initiativeId: 'seed-init-3',
        decidedBy: 'Finance Lead',
        decidedAt: new Date(Date.now() - 7 * 86400000).toISOString()
      }
    ];

    initiatives = [
      { id: 'seed-init-1', name: 'Q1 Feature Launch', status: 'Done', owner: 'Growth Team', created: new Date().toISOString(), summary: 'Launched successfully.' },
      { id: 'seed-init-2', name: 'Product Hunt Co-Marketing', status: 'Done', owner: 'Marketing Lead', created: new Date().toISOString(), summary: 'Executed partner campaign.' },
      { id: 'seed-init-3', name: 'Out-of-Home Billboard Campaign', status: 'Rejected', owner: 'Brand Team', created: new Date().toISOString(), summary: 'Rejected due to budget limits.' }
    ];
  }

  const initiativeMap = new Map<string, Initiative>();
  initiatives.forEach((i) => initiativeMap.set(i.id, i));

  let count = 0;
  for (const dec of decisions) {
    const init = dec.initiativeId ? initiativeMap.get(dec.initiativeId) : undefined;
    console.log(`[Cognee Backfill] Ingesting: "${dec.title}" ($${dec.amount}) - ${dec.status}...`);
    await cogneeClient.ingestDecision(dec, init);
    count++;
  }

  console.log(`\n✔ Cognee backfill completed successfully! ${count} decisions indexed into knowledge graph.`);
}

backfill().catch((err) => {
  console.error('[Cognee Backfill] Unhandled error:', err);
  process.exit(1);
});
