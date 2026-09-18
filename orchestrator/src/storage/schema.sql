-- =====================================================================
-- CorpusAI — PostgreSQL / Supabase Relational Schema
-- Mirrors the Notion Control Plane data models for high-throughput enterprise execution
-- =====================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Initiatives Table
CREATE TABLE IF NOT EXISTS initiatives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Planning', -- 'Planning', 'Awaiting Approval', 'Approved', 'Rejected', 'Executing', 'Done'
    owner VARCHAR(255) NOT NULL,
    summary TEXT DEFAULT '',
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Decisions Table
CREATE TABLE IF NOT EXISTS decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiative_id UUID REFERENCES initiatives(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
    requested_by VARCHAR(50) NOT NULL,            -- 'Marketing', 'Finance', 'Engineering', 'Orchestrator'
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    reasoning_summary TEXT DEFAULT '',
    decided_by VARCHAR(255),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Agent Log Table
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiative_id UUID REFERENCES initiatives(id) ON DELETE CASCADE,
    agent VARCHAR(50) NOT NULL,                   -- 'Marketing', 'Finance', 'Engineering', 'Orchestrator'
    event_type VARCHAR(50) NOT NULL,              -- 'Request', 'Response', 'Disagreement', 'Resolution', 'Action', 'Error'
    summary VARCHAR(255) NOT NULL,
    reasoning TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Actions Table
CREATE TABLE IF NOT EXISTS actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiative_id UUID REFERENCES initiatives(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    tool VARCHAR(50) NOT NULL,                    -- 'GitHub', 'Slack', 'Calendar', 'Email'
    link TEXT NOT NULL,
    performed_by VARCHAR(50) NOT NULL,            -- 'Marketing', 'Finance', 'Engineering', 'Orchestrator'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Policies Table
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_key VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default Policy Seed
INSERT INTO policies (policy_key, title, content)
VALUES (
    'company_budget_policy',
    'Company Budget Policy',
    E'Corporate Budget Policy:\n1. Under $5,000: Auto-approved under established marketing operational guidelines.\n2. $5,000 to $10,000: Requires solid justification and business rationale. May be counter-offered or approved upon review.\n3. Over $10,000: Hard ceiling. Must be rejected or countered with a maximum of $5,000 without Executive Board waiver.'
)
ON CONFLICT (policy_key) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_decisions_initiative_id ON decisions(initiative_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_agent_logs_initiative_id ON agent_logs(initiative_id);
CREATE INDEX IF NOT EXISTS idx_actions_initiative_id ON actions(initiative_id);
