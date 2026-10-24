import { Client } from '@elastic/elasticsearch';
import { config } from './env';
import { logger } from '../utils/logger';

let esClient: Client | null = null;

export const EMAIL_INDEX = 'reachinbox_emails';

export function getElasticsearch(): Client {
  if (!esClient) {
    esClient = new Client({
      node: config.ELASTICSEARCH_URL,
      requestTimeout: 10000,
    });
  }
  return esClient;
}

export async function initElasticsearchIndex(): Promise<void> {
  const client = getElasticsearch();

  try {
    const exists = await client.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await client.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            emailId: { type: 'keyword' },
            userId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            senderName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            recipientEmail: {
              type: 'text',
              fields: { keyword: { type: 'keyword' } },
            },
            subject: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            campaignId: { type: 'keyword' },
            campaignName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            createdAt: { type: 'date' },
          },
        },
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: '1s',
        },
      });
      logger.info('Elasticsearch index created', { index: EMAIL_INDEX });
    } else {
      logger.info('Elasticsearch index already exists', { index: EMAIL_INDEX });
    }
  } catch (err) {
    logger.error('Failed to initialize Elasticsearch index', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Do not crash; email scheduling must continue without ES
  }
}

export async function checkElasticsearchHealth(): Promise<boolean> {
  try {
    const client = getElasticsearch();
    await client.cluster.health({ timeout: '5s' });
    return true;
  } catch {
    return false;
  }
}
