import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

export type PgPool = Pool;

export function createPgPool(connectionString: string, options?: Partial<PoolConfig>): Pool {
  const pool = new Pool({
    connectionString,
    max: options?.max ?? 20,
    idleTimeoutMillis: options?.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: options?.connectionTimeoutMillis ?? 5000,
    ...options,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  pool.on('connect', () => {
    logger.debug('New PostgreSQL connection established');
  });

  return pool;
}
