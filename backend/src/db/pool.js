'use strict';

const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'postgres' });

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Emitted on idle client errors (e.g. connection dropped by the server).
  // Not fatal to the pool itself - pg will remove the bad client.
  logger.error({ err }, 'Unexpected Postgres pool error');
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 200) {
    logger.warn({ text, duration, rows: result.rowCount }, 'Slow query');
  }
  return result;
}

/**
 * Runs `fn` inside a transaction, automatically committing on success and
 * rolling back on any thrown error. `fn` receives a client bound to the
 * transaction - callers must use this client, not the pool, for every
 * statement inside the transaction.
 */
async function withTransaction(fn) {
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

module.exports = { pool, query, withTransaction };
