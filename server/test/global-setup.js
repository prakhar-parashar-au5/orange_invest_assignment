import { resetTestDb } from '../scripts/db-init.js';

// Once per `npm test`: start from an empty orange_invest_test with the current schema. Then, when
// the run is over, empty it again so no test data is left behind.
export async function setup() {
  await resetTestDb();
}

export async function teardown() {
  await resetTestDb();
}
