import pg from 'pg';
import { config } from './config.js';

// Return bigint columns (permission bitfields) as JS numbers; they stay below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export type Queryable = Pick<pg.Pool, 'query'>;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool) {
  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool) {
  const rows = await query<T>(text, params, db);
  return rows[0] as T | undefined;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
