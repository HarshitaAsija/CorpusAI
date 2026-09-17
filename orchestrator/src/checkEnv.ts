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
  'NOTION_POLICY_PAGE_ID',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'WEBHOOK_SHARED_SECRET'
];

export function checkEnv(mode: 'setup' | 'server'): void {
  const keysToCheck = mode === 'setup' ? CORE_SETUP_KEYS : SERVER_KEYS;
  const missingKeys: string[] = [];

  for (const key of keysToCheck) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missingKeys.push(key);
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
    console.log(`\x1b[32m[OK] Environment sanity check passed for '${mode}' mode.\x1b[0m`);
  }
}

// If run directly via command line
if (require.main === module) {
  const mode = process.argv[2] === 'setup' ? 'setup' : 'server';
  checkEnv(mode);
}
