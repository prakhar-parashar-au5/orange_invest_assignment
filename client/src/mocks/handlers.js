import { http, HttpResponse, delay } from 'msw'
import { API_URL } from '../api/config'
import { db, nextId, nowIso, findOrCreateUser } from './db'
import { adminHandlers } from './admin-handlers'

// MSW handlers for every endpoint in API-CONTRACT.md v1.1. Used by the tests and by `npm run dev:mock`.
// These mimic the contract's shapes and error codes; they are NOT the real parsing or agent logic.

const url = (p) => `${API_URL}/api${p}`
const isTest = import.meta.env.MODE === 'test'
const think = () => (isTest ? undefined : delay(800))

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 20000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CATEGORIES = [
  ['Food delivery', true], ['Groceries', true], ['Dining', true], ['Shopping', true],
  ['Travel', true], ['Fuel', true], ['Bills & utilities', true], ['Rent', true],
  ['EMI/loans', true], ['Investments', false], ['Insurance', true], ['Health', true],
  ['Entertainment', true], ['Self-transfer', false], ['Transfers (others)', true],
  ['Salary', true], ['Refunds', true], ['Cash withdrawal', true], ['Unidentified', true],
].map(([name, is_spend]) => ({ name, is_spend }))

// Synthetic merchants the mock "parser" cycles through.
const SYNTHETIC = [
  { merchant: 'Swiggy', category: 'Food delivery', channel: 'UPI', direction: 'debit' },
  { merchant: 'BigBasket', category: 'Groceries', channel: 'UPI', direction: 'debit' },
  { merchant: 'IRCTC', category: 'Travel', channel: 'CARD', direction: 'debit' },
  { merchant: 'Zomato', category: 'Food delivery', channel: 'UPI', direction: 'debit' },
  { merchant: 'Acme Corp', category: 'Salary', channel: 'NEFT', direction: 'credit' },
  { merchant: null, category: 'Cash withdrawal', channel: 'ATM', direction: 'debit' },
  { merchant: 'Zerodha', category: 'Investments', channel: 'IMPS', direction: 'debit' },
]

function err(status, code, message) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function currentUser() {
  const s = db()
  return s.users.find((u) => u.id === s.sessionUserId) || null
}

// Wraps a handler that needs auth. 401 when there is no session, like the real server.
function authed(fn) {
  return async (info) => {
    const user = currentUser()
    if (!user) return err(401, 'UNAUTHENTICATED', 'Please log in.')
    return fn({ ...info, user })
  }
}

const publicUpload = ({ user_id, ...u }) => u
const publicTxn = ({ user_id, ...t }) => t
const publicConv = ({ user_id, ...c }) => c
const publicMsg = ({ conversation_id, ...m }) => m

function paginate(rows, request) {
  const q = new URL(request.url).searchParams
  const page = q.has('page') ? Number(q.get('page')) : 1
  const pageSize = q.has('page_size') ? Number(q.get('page_size')) : 50
  if (!Number.isInteger(page) || page < 1) return { error: err(400, 'VALIDATION_ERROR', 'page must be a positive integer') }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    return { error: err(400, 'VALIDATION_ERROR', 'page_size must be an integer from 1 to 200') }
  }
  const sorted = [...rows].sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : b.id - a.id))
  return {
    body: {
      transactions: sorted.slice((page - 1) * pageSize, page * pageSize).map(publicTxn),
      page,
      page_size: pageSize,
      total: rows.length,
    },
  }
}

// Pretend parser: header must mention "date"; each data row with >= 3 fields becomes a synthetic txn.
async function ingest(user, file) {
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0 || !/date/i.test(lines[0])) {
    return err(422, 'UNKNOWN_FORMAT', "We don't recognise this file's columns. Upload a bank-statement CSV.")
  }
  const data = lines.slice(1)
  if (data.length === 0) return err(422, 'EMPTY_FILE', 'The file has a header row but no transactions.')
  if (data.length > MAX_ROWS) return err(422, 'TOO_MANY_ROWS', `The file has more than ${MAX_ROWS} rows.`)

  const s = db()
  if (!s.rowHashes.has(user.id)) s.rowHashes.set(user.id, new Set())
  const seen = s.rowHashes.get(user.id)
  const upload = {
    id: nextId(), user_id: user.id, filename: file.name, rows_total: data.length,
    rows_inserted: 0, rows_duplicate: 0, rows_rejected: 0, created_at: nowIso(),
  }
  const rejected_rows = []
  data.forEach((line, i) => {
    if (line.split(',').length < 3) {
      upload.rows_rejected++
      if (rejected_rows.length < 50) rejected_rows.push({ line: i + 2, reason: 'Too few columns' })
      return
    }
    if (seen.has(line)) {
      upload.rows_duplicate++
      return
    }
    seen.add(line)
    upload.rows_inserted++
    const kind = SYNTHETIC[i % SYNTHETIC.length]
    const day = String(28 - (i % 28)).padStart(2, '0')
    s.transactions.push({
      id: nextId(),
      user_id: user.id,
      upload_id: upload.id,
      txn_date: `2026-10-${day}`,
      description: `${kind.channel}/${(kind.merchant || 'ATM WDL').toUpperCase()}/${100000 + i}`,
      merchant: kind.merchant,
      category: kind.category,
      amount_paise: kind.direction === 'credit' ? 8500000 : 10000 + ((i * 7919) % 900000),
      direction: kind.direction,
      balance_paise: null,
      channel: kind.channel,
      ref: String(429183746000 + i),
    })
  })
  s.uploads.push(upload)
  return HttpResponse.json({ upload: publicUpload(upload), rejected_rows }, { status: 201 })
}

function cannedReply(text) {
  return (
    `(mock reply) You asked: "${text}".\n\n` +
    'The real answer comes from the backend agent. Example of formatting:\n' +
    '- **Food delivery:** ₹4,210.50\n- **Groceries:** ₹2,980.00'
  )
}

export const handlers = [
  http.get(url('/health'), () => HttpResponse.json({ status: 'ok' })),

  // ---- auth
  http.post(url('/auth/login'), async ({ request }) => {
    const body = await request.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return err(400, 'VALIDATION_ERROR', 'email must be a valid email address')
    }
    const user = findOrCreateUser(email)
    db().sessionUserId = user.id
    return HttpResponse.json({ user })
  }),
  http.post(url('/auth/logout'), () => {
    db().sessionUserId = null
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(url('/auth/me'), authed(({ user }) => HttpResponse.json({ user }))),

  // ---- categories
  http.get(url('/categories'), authed(() => HttpResponse.json({ categories: CATEGORIES }))),

  // ---- uploads
  http.post(
    url('/uploads'),
    authed(async ({ request, user }) => {
      const form = await request.formData().catch(() => null)
      const file = form?.get('file')
      if (!file || typeof file === 'string') return err(400, 'NO_FILE', 'Choose a file to upload.')
      if (file.size > MAX_UPLOAD_BYTES) return err(413, 'FILE_TOO_LARGE', 'The file is over 5 MB.')
      if (!/\.csv$/i.test(file.name)) return err(415, 'UNSUPPORTED_FILE_TYPE', 'Only CSV files are supported.')
      await think()
      return ingest(user, file)
    }),
  ),
  http.get(
    url('/uploads'),
    authed(({ user }) => {
      const uploads = db()
        .uploads.filter((u) => u.user_id === user.id)
        .sort((a, b) => b.id - a.id)
        .map(publicUpload)
      return HttpResponse.json({ uploads })
    }),
  ),
  http.get(
    url('/uploads/:id/transactions'),
    authed(({ request, params, user }) => {
      const upload = db().uploads.find((u) => u.id === Number(params.id) && u.user_id === user.id)
      if (!upload) return err(404, 'NOT_FOUND', 'Upload not found.')
      const rows = db().transactions.filter((t) => t.upload_id === upload.id)
      const { error, body } = paginate(rows, request)
      return error || HttpResponse.json(body)
    }),
  ),
  http.get(
    url('/transactions'),
    authed(({ request, user }) => {
      const q = new URL(request.url).searchParams
      let rows = db().transactions.filter((t) => t.user_id === user.id)
      const from = q.get('from'), to = q.get('to'), category = q.get('category'), direction = q.get('direction')
      if (from) rows = rows.filter((t) => t.txn_date >= from)
      if (to) rows = rows.filter((t) => t.txn_date <= to)
      if (category) rows = rows.filter((t) => t.category === category)
      if (direction) rows = rows.filter((t) => t.direction === direction)
      const { error, body } = paginate(rows, request)
      return error || HttpResponse.json(body)
    }),
  ),

  // ---- conversations
  http.post(
    url('/conversations'),
    authed(({ user }) => {
      const now = nowIso()
      const conv = { id: nextId(), user_id: user.id, title: null, created_at: now, updated_at: now }
      db().conversations.push(conv)
      return HttpResponse.json({ conversation: publicConv(conv) }, { status: 201 })
    }),
  ),
  http.get(
    url('/conversations'),
    authed(({ user }) => {
      const conversations = db()
        .conversations.filter((c) => c.user_id === user.id)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id))
        .map(publicConv)
      return HttpResponse.json({ conversations })
    }),
  ),
  http.get(
    url('/conversations/:id/messages'),
    authed(({ params, user }) => {
      const conv = db().conversations.find((c) => c.id === Number(params.id) && c.user_id === user.id)
      if (!conv) return err(404, 'NOT_FOUND', 'Conversation not found.')
      const messages = db()
        .messages.filter((m) => m.conversation_id === conv.id)
        .sort((a, b) => a.id - b.id)
        .map(publicMsg)
      return HttpResponse.json({ messages })
    }),
  ),
  http.post(
    url('/conversations/:id/messages'),
    authed(async ({ request, params, user }) => {
      const s = db()
      const conv = s.conversations.find((c) => c.id === Number(params.id) && c.user_id === user.id)
      if (!conv) return err(404, 'NOT_FOUND', 'Conversation not found.')
      const body = await request.json().catch(() => ({}))
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 2000) return err(400, 'VALIDATION_ERROR', 'text must be 1 to 2000 characters')

      const user_message = { id: nextId(), conversation_id: conv.id, role: 'user', content: text, created_at: nowIso() }
      s.messages.push(user_message)
      if (conv.title === null) conv.title = text.slice(0, 60)
      conv.updated_at = nowIso()

      await think()
      // Lets testers see the error path in dev:mock: any message containing "fail" errors.
      if (/fail/i.test(text)) {
        return err(502, 'AGENT_UNAVAILABLE', 'The assistant is unavailable right now. Try again in a moment.')
      }
      const assistant_message = {
        id: nextId(), conversation_id: conv.id, role: 'assistant', content: cannedReply(text), created_at: nowIso(),
      }
      s.messages.push(assistant_message)
      return HttpResponse.json(
        { user_message: publicMsg(user_message), assistant_message: publicMsg(assistant_message) },
        { status: 201 },
      )
    }),
  ),

  ...adminHandlers,
]
