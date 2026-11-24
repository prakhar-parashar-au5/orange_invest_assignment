// In-memory state behind the MSW handlers. Shapes follow API-CONTRACT.md. Synthetic data only.
import { seedAdminData } from './admin-data'

let state

function fresh() {
  return {
    sessionUserId: null, // stands in for the oi_session cookie
    users: [],
    uploads: [],
    transactions: [],
    rowHashes: new Map(), // user_id → Set of row keys, for duplicate detection
    conversations: [],
    messages: [],
    admin: seedAdminData(),
    nextId: 1,
  }
}

state = fresh()

export function db() {
  return state
}

export function nextId() {
  return state.nextId++
}

export function resetMockDb() {
  state = fresh()
}

export function nowIso() {
  // ISO 8601 in IST with offset, like the server sends.
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19)
  return `${ist}+05:30`
}

export function findOrCreateUser(rawEmail) {
  const email = rawEmail.trim().toLowerCase()
  let user = state.users.find((u) => u.email === email)
  if (!user) {
    // Mock rule: any email starting with "admin@" is an admin (the real server reads users.role).
    user = { id: nextId(), email, role: email.startsWith('admin@') ? 'admin' : 'user', created_at: nowIso() }
    state.users.push(user)
  }
  return user
}

export function seedUser(email, { login = false } = {}) {
  const user = findOrCreateUser(email)
  if (login) state.sessionUserId = user.id
  return user
}

/** Test/dev helper: an upload plus the given transactions, owned by `userId`. */
export function seedUpload(userId, { filename = 'synthetic.csv', transactions = [] } = {}) {
  const upload = {
    id: nextId(),
    user_id: userId,
    filename,
    rows_total: transactions.length,
    rows_inserted: transactions.length,
    rows_duplicate: 0,
    rows_rejected: 0,
    created_at: nowIso(),
  }
  state.uploads.push(upload)
  for (const t of transactions) {
    state.transactions.push({
      id: nextId(),
      user_id: userId,
      upload_id: upload.id,
      description: 'UPI/SYNTHETIC',
      merchant: null,
      category: 'Unidentified',
      balance_paise: null,
      channel: 'OTHER',
      ref: null,
      ...t,
    })
  }
  return upload
}
