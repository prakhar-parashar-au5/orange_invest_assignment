import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { testApp, loggedInAgent } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const HEADER = 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n';

let ctx;
beforeAll(() => {
  ctx = testApp();
});
afterAll(() => ctx.close());

const upload = (agent, buffer, filename = 'statement.csv', contentType = 'text/csv') =>
  agent.post('/api/uploads').attach('file', buffer, { filename, contentType });

async function countUploads(userId) {
  const [[{ n }]] = await ctx.db.query('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?', [userId]);
  return n;
}

describe('POST /api/uploads', () => {
  it('needs a login', async () => {
    const res = await upload(request(ctx.app), fixture('hdfc-basic.csv'));

    expect(res.status).toBe(401);
  });

  it('parses, categorises and stores a bank CSV, reporting rejected rows with line numbers', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'up');

    const res = await upload(agent, fixture('hdfc-basic.csv'), 'hdfc-oct.csv');

    expect(res.status).toBe(201);
    expect(res.body.upload).toMatchObject({
      filename: 'hdfc-oct.csv',
      rows_total: 8,
      rows_inserted: 6,
      rows_duplicate: 0,
      rows_rejected: 2,
    });
    expect(res.body.upload.created_at).toMatch(/\+05:30$/);
    expect(res.body.rejected_rows).toEqual([
      { line: 7, reason: expect.stringMatching(/date/i) },
      { line: 8, reason: expect.stringMatching(/amount/i) },
    ]);

    const list = await agent.get(`/api/uploads/${res.body.upload.id}/transactions`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, page_size: 50, total: 6 });
    const byDate = Object.fromEntries(list.body.transactions.map((t) => [t.txn_date, t]));

    expect(byDate['2026-10-01']).toMatchObject({
      direction: 'credit',
      amount_paise: 12500000,
      balance_paise: 37500000,
      category: 'Salary',
      channel: 'NEFT',
      merchant: 'Acme',
      ref: null,
    });
    expect(byDate['2026-10-03']).toMatchObject({ direction: 'debit', amount_paise: 2800000, category: 'Rent', channel: 'IMPS' });
    expect(byDate['2026-10-05']).toMatchObject({
      amount_paise: 48900,
      category: 'Food delivery',
      merchant: 'Swiggy',
      ref: '0000429183746512',
      description: 'UPI-SWIGGY-swiggy@icici-ICIC0000001-429183746512-Payment from Phone',
    });
    expect(byDate['2026-10-06']).toMatchObject({ category: 'Transfers (others)', merchant: 'Rahul Sharma' });
    expect(byDate['2026-10-07']).toMatchObject({ category: 'Cash withdrawal', channel: 'ATM', merchant: null });
    expect(byDate['2026-10-09']).toMatchObject({ amount_paise: 31250, category: 'Food delivery' });
    // newest first
    expect(list.body.transactions.map((t) => t.txn_date)).toEqual([
      '2026-10-09',
      '2026-10-07',
      '2026-10-06',
      '2026-10-05',
      '2026-10-03',
      '2026-10-01',
    ]);
    // internal fields never leave the server
    expect(list.body.transactions[0]).not.toHaveProperty('raw_json');
    expect(list.body.transactions[0]).not.toHaveProperty('dedup_hash');
    expect(list.body.transactions[0]).not.toHaveProperty('user_id');
  });

  it('re-uploading the same file inserts 0 rows', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'reup');
    await upload(agent, fixture('hdfc-basic.csv'));

    const again = await upload(agent, fixture('hdfc-basic.csv'));

    expect(again.status).toBe(201);
    expect(again.body.upload).toMatchObject({ rows_total: 8, rows_inserted: 0, rows_duplicate: 6, rows_rejected: 2 });
    const all = await agent.get('/api/transactions');
    expect(all.body.total).toBe(6);
  });

  it('keeps two genuinely identical rows in one file, and still dedups them on re-upload', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'chai');

    const first = await upload(agent, fixture('hdfc-identical-rows.csv'));
    const second = await upload(agent, fixture('hdfc-identical-rows.csv'));

    expect(first.body.upload).toMatchObject({ rows_inserted: 3, rows_duplicate: 0 });
    expect(second.body.upload).toMatchObject({ rows_inserted: 0, rows_duplicate: 3 });
    const all = await agent.get('/api/transactions');
    expect(all.body.transactions.filter((t) => t.amount_paise === 2000)).toHaveLength(2);
  });

  it('dedups an overlapping statement: only the new rows are inserted', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'overlap');
    const lines = fixture('hdfc-basic.csv').toString().trim().split('\n');
    const extra = '10/10/26,UPI-BLINKIT-blinkit@hdfcbank-HDFC0000001-512398765499-groceries,0000512398765499,10/10/26,845.00,,"3,39,593.50"';

    await upload(agent, Buffer.from(lines.slice(0, 4).join('\n')));
    const res = await upload(agent, Buffer.from([...lines, extra].join('\n')));

    expect(res.body.upload).toMatchObject({ rows_inserted: 4, rows_duplicate: 3, rows_rejected: 2 });
  });

  it('finds the header after a preamble and reads a signed-amount layout with Dr/Cr', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'pre');

    const res = await upload(agent, fixture('with-preamble.csv'));

    expect(res.status).toBe(201);
    expect(res.body.upload).toMatchObject({ rows_inserted: 2, rows_rejected: 0 });
    const list = await agent.get(`/api/uploads/${res.body.upload.id}/transactions`);
    expect(list.body.transactions).toEqual([
      expect.objectContaining({ txn_date: '2026-10-15', direction: 'credit', amount_paise: 12500000, category: 'Salary' }),
      expect.objectContaining({ txn_date: '2026-10-14', direction: 'debit', amount_paise: 64900, category: 'Entertainment' }),
    ]);
  });

  it('a file where every row is rejected still returns 201 with 0 inserted', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'allbad');

    const res = await upload(agent, Buffer.from(`${HEADER}99/99/99,X,,,1.00,,\n`));

    expect(res.status).toBe(201);
    expect(res.body.upload).toMatchObject({ rows_total: 1, rows_inserted: 0, rows_rejected: 1 });
  });

  describe('all-or-nothing errors create no upload record', () => {
    it.each([
      ['unknown header', () => fixture('unknown-header.csv'), 'statement.csv', 'text/csv', 422, 'UNKNOWN_FORMAT'],
      ['header only', () => fixture('header-only.csv'), 'statement.csv', 'text/csv', 422, 'EMPTY_FILE'],
      ['not a CSV (extension)', () => Buffer.from('%PDF-1.4'), 'statement.pdf', 'application/pdf', 415, 'UNSUPPORTED_FILE_TYPE'],
      ['not a CSV (mime)', () => fixture('hdfc-basic.csv'), 'statement.csv', 'image/png', 415, 'UNSUPPORTED_FILE_TYPE'],
      ['binary junk', () => Buffer.from([0, 159, 146, 150, 0, 1]), 'statement.csv', 'text/csv', 422, 'UNKNOWN_FORMAT'],
    ])('%s → %i %s', async (_label, body, filename, contentType, status, code) => {
      const { agent, user } = await loggedInAgent(ctx.app, 'err');

      const res = await upload(agent, body(), filename, contentType);

      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(await countUploads(user.id)).toBe(0);
    });

    it('no file field → 400 NO_FILE', async () => {
      const { agent, user } = await loggedInAgent(ctx.app, 'nofile');

      const res = await agent.post('/api/uploads').field('other', 'x');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE');
      expect(await countUploads(user.id)).toBe(0);
    });

    it('a file over 5 MB → 413 FILE_TOO_LARGE', async () => {
      const { agent, user } = await loggedInAgent(ctx.app, 'big');
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');

      const res = await upload(agent, big);

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(await countUploads(user.id)).toBe(0);
    });

    it('more than 20,000 data rows → 422 TOO_MANY_ROWS', async () => {
      const { agent, user } = await loggedInAgent(ctx.app, 'rows');
      const row = '01/10/26,POS X SHOP,,01/10/26,1.00,,1.00\n';
      const body = Buffer.from(HEADER + row.repeat(20001));

      const res = await upload(agent, body);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('TOO_MANY_ROWS');
      expect(await countUploads(user.id)).toBe(0);
    });
  });
});

describe('GET /api/uploads', () => {
  it("lists only the user's own uploads, newest first", async () => {
    const a = await loggedInAgent(ctx.app, 'list-a');
    const b = await loggedInAgent(ctx.app, 'list-b');
    const first = await upload(a.agent, fixture('hdfc-basic.csv'), 'one.csv');
    const second = await upload(a.agent, fixture('hdfc-identical-rows.csv'), 'two.csv');
    await upload(b.agent, fixture('hdfc-basic.csv'), 'b.csv');

    const res = await a.agent.get('/api/uploads');

    expect(res.status).toBe(200);
    expect(res.body.uploads.map((u) => u.id)).toEqual([second.body.upload.id, first.body.upload.id]);
    expect(res.body.uploads[0]).toEqual(second.body.upload);
  });
});

describe('data isolation', () => {
  it("user B gets 404 for user A's upload, and never sees A's transactions", async () => {
    const a = await loggedInAgent(ctx.app, 'iso-a');
    const b = await loggedInAgent(ctx.app, 'iso-b');
    const up = await upload(a.agent, fixture('hdfc-basic.csv'));

    const res = await b.agent.get(`/api/uploads/${up.body.upload.id}/transactions`);
    const bAll = await b.agent.get('/api/transactions');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(bAll.body.total).toBe(0);
  });

  it('the same file uploaded by two users is stored for both (dedup is per user)', async () => {
    const a = await loggedInAgent(ctx.app, 'iso2-a');
    const b = await loggedInAgent(ctx.app, 'iso2-b');

    await upload(a.agent, fixture('hdfc-basic.csv'));
    const res = await upload(b.agent, fixture('hdfc-basic.csv'));

    expect(res.body.upload.rows_inserted).toBe(6);
  });
});

describe('GET /api/uploads/:id/transactions', () => {
  it('paginates', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'page');
    const up = await upload(agent, fixture('hdfc-basic.csv'));

    const p1 = await agent.get(`/api/uploads/${up.body.upload.id}/transactions?page=1&page_size=4`);
    const p2 = await agent.get(`/api/uploads/${up.body.upload.id}/transactions?page=2&page_size=4`);

    expect(p1.body).toMatchObject({ page: 1, page_size: 4, total: 6 });
    expect(p1.body.transactions).toHaveLength(4);
    expect(p2.body.transactions).toHaveLength(2);
    const ids = [...p1.body.transactions, ...p2.body.transactions].map((t) => t.id);
    expect(new Set(ids).size).toBe(6);
  });

  it.each([['abc'], ['0'], ['-1'], ['999999999']])('id %s → 404', async (id) => {
    const { agent } = await loggedInAgent(ctx.app, 'badid');

    const res = await agent.get(`/api/uploads/${id}/transactions`);

    expect(res.status).toBe(404);
  });

  it.each([['page=0'], ['page=x'], ['page_size=0'], ['page_size=201'], ['page=1.5']])('%s → 400', async (q) => {
    const { agent } = await loggedInAgent(ctx.app, 'badpage');
    const up = await upload(agent, fixture('hdfc-identical-rows.csv'));

    const res = await agent.get(`/api/uploads/${up.body.upload.id}/transactions?${q}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/transactions', () => {
  let agent;
  beforeAll(async () => {
    ({ agent } = await loggedInAgent(ctx.app, 'filters'));
    await upload(agent, fixture('hdfc-basic.csv'));
  });

  it('filters by date range (inclusive), category and direction', async () => {
    const range = await agent.get('/api/transactions?from=2026-10-03&to=2026-10-06');
    const food = await agent.get('/api/transactions?category=Food%20delivery');
    const credits = await agent.get('/api/transactions?direction=credit');
    const combined = await agent.get('/api/transactions?from=2026-10-06&category=Food%20delivery&direction=debit');

    expect(range.body.transactions.map((t) => t.txn_date)).toEqual(['2026-10-06', '2026-10-05', '2026-10-03']);
    expect(food.body.total).toBe(2);
    expect(credits.body.transactions.map((t) => t.category)).toEqual(['Salary']);
    expect(combined.body.transactions.map((t) => t.amount_paise)).toEqual([31250]);
  });

  it.each([
    ['from=2026-13-01'],
    ['to=yesterday'],
    ['from=2026-10-10&to=2026-10-01'],
    ['category=Crypto'],
    ['direction=sideways'],
  ])('%s → 400 VALIDATION_ERROR', async (q) => {
    const res = await agent.get(`/api/transactions?${q}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('a full generated statement (test/fixtures/synthetic-seed1-2026-11-24.csv)', () => {
  it('uploads with 0 rejected rows, and re-uploads with 0 inserted', async () => {
    const { agent } = await loggedInAgent(ctx.app, 'gen');
    const file = fixture('synthetic-seed1-2026-11-24.csv');
    const dataRows = file.toString().trim().split('\n').length - 1;

    const first = await upload(agent, file);
    const second = await upload(agent, file);

    expect(first.status).toBe(201);
    expect(first.body.upload).toMatchObject({ rows_total: dataRows, rows_inserted: dataRows, rows_rejected: 0 });
    expect(second.body.upload).toMatchObject({ rows_inserted: 0, rows_duplicate: dataRows });
  });
});
