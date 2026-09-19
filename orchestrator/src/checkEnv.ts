import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the orchestrator directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const CORE_SETUP_KEYS = [
  'NOTION_PARENT_PAGE_ID',
  'NOTION_ORCHESTRATOR_TOKEN'
];

const SERVER_KEYS = [
  'NVIDIA_API_KEY',
  'NOTION_PARENT_PAGE_ID',
  'NOTION_ORCHESTRATOR_TOKEN',
  'NOTION_MARKETING_TOKEN',
  'NOTION_FINANCE_TOKEN',
  'NOTION_ENGINEERING_TOKEN',
  'NOTION_INITIATIVES_DB_ID',
  'NOTION_AGENTLOG_DB_ID',
  'NOTION_DECISIONS_DB_ID',
  'NOTION_ACTIONS_DB_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'WEBHOOK_SHARED_SECRET'
];

const DEFAULT_FALLBACKS: Record<string, string> = {
  'NVIDIA_API_KEY': 'nvapi-placeholder-key',
  'NOTION_PARENT_PAGE_ID': '00000000000000000000000000000000',
  'NOTION_ORCHESTRATOR_TOKEN': 'ntn_placeholder_orchestrator',
  'NOTION_MARKETING_TOKEN': 'ntn_placeholder_marketing',
  'NOTION_FINANCE_TOKEN': 'ntn_placeholder_finance',
  'NOTION_ENGINEERING_TOKEN': 'ntn_placeholder_engineering',
  'NOTION_INITIATIVES_DB_ID': '00000000000000000000000000000000',
  'NOTION_AGENTLOG_DB_ID': '00000000000000000000000000000000',
  'NOTION_DECISIONS_DB_ID': '00000000000000000000000000000000',
  'NOTION_ACTIONS_DB_ID': '00000000000000000000000000000000',
  'GITHUB_TOKEN': 'ghp_placeholder123456789',
  'GITHUB_REPO': 'HarshitaAsija/CorpusAI',
  'SLACK_BOT_TOKEN': 'xoxb-placeholder',
  'SLACK_CHANNEL_ID': 'C0000000000',
  'WEBHOOK_SHARED_SECRET': 'default-shared-secret-12345'
};

export function checkEnv(mode: 'setup' | 'server'): void {
  const keysToCheck = mode === 'setup' ? CORE_SETUP_KEYS : SERVER_KEYS;
  const missingKeys: string[] = [];

  for (const key of keysToCheck) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missingKeys.push(key);
      // Auto-populate default fallback placeholder so server components don't throw on startup
      if (mode === 'server' && DEFAULT_FALLBACKS[key]) {
        process.env[key] = DEFAULT_FALLBACKS[key];
      }
    }
  }

  if (missingKeys.length > 0) {
    if (mode === 'setup') {
      console.error(`\x1b[31m[ERROR] Missing required environment variables for '${mode}':\x1b[0m`);
      missingKeys.forEach(k => console.error(` - ${k}`));
      console.error('\nPlease check your .env file and ensure these values are populated.');
      process.exit(1);
    } else {
      console.warn(`\x1b[33m[WARN] Missing ${missingKeys.length} environment variable(s) for 'server' mode:\x1b[0m`);
      missingKeys.forEach(k => console.warn(` - ${k} (using fallback: ${process.env[k]})`));
      console.warn('\x1b[33m[WARN] Server starting with fallback values. Real API calls will degrade to mock/in-memory mode.\x1b[0m');
    }
  } else {
    const storageBackend = (process.env.STORAGE_BACKEND || 'notion').toUpperCase();
    console.log(`\x1b[32m[OK] Environment sanity check passed for '${mode}' mode (Storage: ${storageBackend}).\x1b[0m`);
  }

  // Non-fatal warnings for optional/placeholder values
  if (mode === 'server') {
    if (process.env.GITHUB_TOKEN?.startsWith('ghp_placeholder')) {
      console.warn('\x1b[33m[WARN] GITHUB_TOKEN is a placeholder. Real GitHub issue creation will use mock links.\x1b[0m');
    }
    if (process.env.SLACK_BOT_TOKEN?.startsWith('xoxb-placeholder')) {
      console.warn('\x1b[33m[WARN] SLACK_BOT_TOKEN is a placeholder. Real Slack posts will use mock links.\x1b[0m');
    }
    if (process.env.COGNEE_ENABLED === 'true' && !process.env.COGNEE_API_KEY) {
      console.warn('\x1b[33m[WARN] COGNEE_ENABLED=true but COGNEE_API_KEY is not set.\x1b[0m');
    }
    if (process.env.APPROVAL_BACKEND === 'n8n' && !process.env.N8N_APPROVAL_WEBHOOK_URL) {
      console.warn('\x1b[33m[WARN] APPROVAL_BACKEND=n8n but N8N_APPROVAL_WEBHOOK_URL is not set.\x1b[0m');
    }
  }
}

// If run directly via command line
if (require.main === module) {
  const mode = process.argv[2] === 'setup' ? 'setup' : 'server';
  checkEnv(mode);
}
