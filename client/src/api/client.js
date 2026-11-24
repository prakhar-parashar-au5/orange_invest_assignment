import { API_URL } from './config'

// Every failed call throws this. UI code branches on `code` (from the contract), never on `message`.
export class ApiError extends Error {
  constructor({ status, code, message }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// Called when any request (other than /auth/me) gets 401 UNAUTHENTICATED, e.g. an expired cookie.
// The auth provider registers this to drop the user back to the login screen.
let onUnauthenticated = null
export function setUnauthenticatedHandler(fn) {
  onUnauthenticated = fn
}

function withQuery(path, query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * The one place the client talks to the API.
 * - `body`: a plain object is sent as JSON; FormData is sent as multipart (browser sets the boundary).
 * - Always sends the session cookie (`credentials: 'include'`).
 * - 204 → null. Error responses → ApiError.
 */
export async function request(path, { method = 'GET', body, query, signal } = {}) {
  const headers = {}
  let payload
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${API_URL}/api${withQuery(path, query)}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal,
    })
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    })
  }

  if (res.status === 204) return null

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    if (e && typeof e.code === 'string') {
      if (e.code === 'UNAUTHENTICATED' && path !== '/auth/me') onUnauthenticated?.()
      throw new ApiError({ status: res.status, code: e.code, message: e.message || e.code })
    }
    throw new ApiError({
      status: res.status,
      code: `HTTP_${res.status}`,
      message: `The server returned an unexpected error (${res.status}).`,
    })
  }
  return data
}

export function getHealth() {
  return request('/health')
}
