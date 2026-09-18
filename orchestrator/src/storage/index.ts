import { IStorageClient } from './storageInterface';
import { NotionClientWrapper } from '../notion/client';
import { PostgresClientWrapper } from './postgresClient';

export function getStorageClient(): IStorageClient {
  const backend = (process.env.STORAGE_BACKEND || 'notion').toLowerCase();

  if (backend === 'postgres') {
    console.log('[Storage Factory] Using PostgreSQL storage backend');
    return new PostgresClientWrapper();
  }

  console.log('[Storage Factory] Using Notion storage backend (default)');
  return new NotionClientWrapper();
}

export * from './storageInterface';
export * from './postgresClient';
