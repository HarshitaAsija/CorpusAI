import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the orchestrator directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const CORE_SETUP_KEYS = [
  'NOTION_PARENT_PAGE_ID',
  'NOTION_ORCHESTRATOR_TOKEN'
];

const BASE_SERVER_KEYS = [
  'NVIDIA_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'WEBHOOK_SHARED_SECRET'
];

const NOTION_SERVER_KEYS = [
  'NOTION_PARENT_PAGE_ID',
  'NOTION_ORCHESTRATOR_TOKEN',
  'NOTION_MARKETING_TOKEN',
  'NOTION_FINANCE_TOKEN',
  'NOTION_ENGINEERING_TOKEN',
  'NOTION_INITIATIVES_DB_ID',
  'NOTION_AGENTLOG_DB_ID',
  'NOTION_DECISIONS_DB_ID',
  'NOTION_ACTIONS_DB_ID',
  'NOTION_POLICY_PAGE_ID'
];

export function checkEnv(mode: 'setup' | 'server'): void {
  const missingKeys: string[] = [];

  if (mode === 'setup') {
    for (const key of CORE_SETUP_KEYS) {
      if (!process.env[key] || process.env[key]!.trim() === '') {
        missingKeys.push(key);
      }
    }
  } else {
    // Server mode
    const storageBackend = (process.env.STORAGE_BACKEND || 'notion').toLowerCase();

    // Check base server keys
    for (const key of BASE_SERVER_KEYS) {
      if (!process.env[key] || process.env[key]!.trim() === '') {
        missingKeys.push(key);
      }
    }

    // Check storage-specific keys
    if (storageBackend === 'postgres') {
      if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
        missingKeys.push('DATABASE_URL');
      }
    } else {
      // Default: Notion
      for (const key of NOTION_SERVER_KEYS) {
        if (!process.env[key] || process.env[key]!.trim() === '') {
          missingKeys.push(key);
        }
      }
    }

    // Check approval-specific keys
    if (process.env.APPROVAL_BACKEND === 'n8n') {
      if (!process.env.N8N_APPROVAL_WEBHOOK_URL || process.env.N8N_APPROVAL_WEBHOOK_URL.trim() === '') {
        console.warn('\x1b[33m[WARN] APPROVAL_BACKEND is set to "n8n", but N8N_APPROVAL_WEBHOOK_URL is not set.\x1b[0m');
      }
    }

    // Check Cognee keys if enabled
    if (process.env.COGNEE_ENABLED === 'true') {
      if (!process.env.COGNEE_API_KEY || process.env.COGNEE_API_KEY.trim() === '') {
        console.warn('\x1b[33m[WARN] COGNEE_ENABLED is "true", but COGNEE_API_KEY is not set.\x1b[0m');
      }
    }

    // Check placeholder integration tokens and warn explicitly
    if (process.env.GITHUB_TOKEN?.startsWith('ghp_placeholder')) {
      console.warn('\x1b[33m[WARN] GITHUB_TOKEN is using placeholder value "ghp_placeholder...". Real GitHub issue creation will fall back to dummy mock links.\x1b[0m');
    }
    if (process.env.SLACK_BOT_TOKEN?.startsWith('xoxb-placeholder')) {
      console.warn('\x1b[33m[WARN] SLACK_BOT_TOKEN is using placeholder value "xoxb-placeholder...". Real Slack announcements will fall back to dummy mock links.\x1b[0m');
    }
  }

  if (missingKeys.length > 0) {
    console.error(`\x1b[31m[ERROR] Missing required environment variables for '${mode}':\x1b[0m`);
    missingKeys.forEach(k => {
      console.error(` - ${k}`);
    });
    console.error('\nPlease check your .env file and ensure these values are populated.');
    process.exit(1);
  } else {
    const backendLabel = (process.env.STORAGE_BACKEND || 'notion').toUpperCase();
    console.log(`\x1b[32m[OK] Environment sanity check passed for '${mode}' mode (Storage: ${backendLabel}).\x1b[0m`);
  }
}

// If run directly via command line
if (require.main === module) {
  const mode = process.argv[2] === 'setup' ? 'setup' : 'server';
  checkEnv(mode);
}
