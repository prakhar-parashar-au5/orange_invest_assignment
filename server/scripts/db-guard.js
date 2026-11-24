// Scripts that write admin or fixture data only run on disposable databases.

const SAFE_SUFFIX = /_(dev|test|demo)$/;

/** @returns {string} the database name, or exits when it isn't allowed */
export function checkDbName(databaseUrl, allowDb, { action = 'write to', bypass = true } = {}) {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!SAFE_SUFFIX.test(name) && name !== allowDb) {
    console.error(`refusing to ${action} ${name}: only databases ending in _dev, _test or _demo${bypass ? `, unless you pass --allow-db ${name}` : ''}`);
    process.exit(1);
  }
  return name;
}
