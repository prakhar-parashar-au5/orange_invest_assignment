import mysql from 'mysql2/promise';

/**
 * A mysql2 promise pool.
 * - Timestamps are UTC both ways: the session time_zone is set to +00:00 and the driver reads and
 *   writes DATETIME as UTC.
 * - DATE columns (txn_date) come back as 'YYYY-MM-DD' strings, never JS Dates, so an IST calendar
 *   date can't drift by a day through timezone conversion.
 * - BIGINT columns (paise, ids) come back as JS numbers. That is exact up to 2^53, which is about
 *   ₹90 trillion in paise.
 *
 * @param {string} url mysql://user:pass@host:port/db
 * @param {{ multipleStatements?: boolean, connectionLimit?: number }} [opts]
 */
export function createPool(url, opts = {}) {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: opts.connectionLimit ?? 10,
    multipleStatements: opts.multipleStatements ?? false,
    timezone: 'Z',
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
  });

  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });

  return pool;
}

/**
 * The agent's pool: same DATABASE_URL and user as the app, but every connection is put in READ ONLY
 * transaction mode the moment it's created, before it's handed out. MySQL then rejects INSERT,
 * UPDATE and DELETE on it (ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION). A separate pool, so the
 * shared app pool is never switched.
 */
export function createReadOnlyPool(url, opts = {}) {
  const pool = createPool(url, { connectionLimit: 5, ...opts });
  pool.pool.on('connection', (conn) => {
    conn.query('SET SESSION TRANSACTION READ ONLY');
  });
  return pool;
}
