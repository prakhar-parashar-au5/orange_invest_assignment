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
