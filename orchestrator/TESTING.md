# CorpusAI Integration Testing Guide

This document provides isolated, step-by-step verification commands to independently test **PostgreSQL**, **Cognee AI Memory**, and **n8n Approval Workflows** before a live demo.

---

## 🗄️ Test 1: Testing PostgreSQL Storage (`STORAGE_BACKEND=postgres`)

### Step 1: Set Environment Variables
In `orchestrator/.env`:
```env
STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/corpusai
DATABASE_SSL=false
```

### Step 2: Initialize Database Schema
Run the schema initialization against your local or Supabase PostgreSQL instance:
```bash
psql $DATABASE_URL -f orchestrator/src/storage/schema.sql
```

### Step 3: Run Environment Sanity Check
```bash
cd orchestrator
npm run check-env
```

**Expected Console Output**:
```text
[OK] Environment sanity check passed for 'server' mode (Storage: POSTGRES).
```

---

## 🧠 Test 2: Testing Cognee AI Memory (`COGNEE_ENABLED=true`)

### Step 1: Set Environment Variables
In `orchestrator/.env`:
```env
COGNEE_ENABLED=true
COGNEE_API_KEY=your-actual-cognee-api-key
COGNEE_API_URL=https://api.cognee.ai
COGNEE_DATASET_NAME=corporate_decisions
```

### Step 2: Run Cognee Backfill Script
Execute the backfill script to populate initial decision precedents into Cognee graph memory:
```bash
cd orchestrator
npm run backfill-cognee
```

**Expected Console Output**:
```text
[Cognee Backfill] Starting ingestion of baseline decisions into dataset "corporate_decisions"...
[Cognee] Successfully ingested decision "Approve $5,000 Campaign Budget" ($5000) into dataset "corporate_decisions"
[Cognee] Successfully ingested decision "Approve $7,500 Q3 Growth Budget" ($7500) into dataset "corporate_decisions"
[Cognee Backfill] Ingestion complete. Ingested 2 decisions.
```

### Step 3: Verify Precedent Search in Terminal
Trigger an initiative goal with requested budget around $5,000 to test semantic search:
```bash
curl -X POST "http://localhost:3000/api/initiatives/trigger" \
  -H "Content-Type: application/json" \
  -d '{ "goal": "Launch Q3 marketing expansion with $5200 budget", "owner": "Marketing Lead" }'
```

**Expected Server Logs**:
```text
[FSM] Querying Cognee Knowledge Graph for historical precedent...
[Autonomy Engine] Consulting Cognee Knowledge Graph memory...
[Autonomy Engine] Cognee high-confidence match approved! [COGNEE-ASSISTED] Match Score: 0.85/1.0 (High Confidence)...
```

---

## ⚡ Test 3: Testing n8n Approval Callback (`APPROVAL_BACKEND=n8n`)

### Step 1: Set Environment Variables
In `orchestrator/.env`:
```env
APPROVAL_BACKEND=n8n
N8N_APPROVAL_WEBHOOK_URL=https://your-n8n-instance.app.n8n.cloud/webhook/corpusai-approval
WEBHOOK_SHARED_SECRET=your-webhook-shared-secret
```

### Step 2: Start Server
```bash
cd orchestrator
npm run dev
```

### Step 3: Trigger Approval Webhook Callback
Simulate an instant human approval callback from n8n:
```bash
curl -X POST "http://localhost:3000/webhooks/approval" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-shared-secret" \
  -d '{
    "decisionId": "test-decision-001",
    "initiativeId": "test-initiative-001",
    "status": "Approved",
    "decidedBy": "Human Manager (via n8n Manual Test)"
  }'
```

**Expected API Response**:
```json
{
  "success": true,
  "message": "FSM resumed via n8n approval webhook"
}
```

**Expected Server Log Output**:
```text
[n8n Webhook] Received approval callback for Decision test-decision-001: status -> Approved
[n8n Webhook] Instantly signaling FSM for initiative: test-initiative-001
```
