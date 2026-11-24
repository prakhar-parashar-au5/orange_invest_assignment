// Base URL of the Express API. Vite inlines VITE_* at build time, so this is public, never secret.
//   undefined in dev  → http://localhost:4100 (the local backend)
//   empty string      → same origin: requests go to relative /api/... (deploy behind one host)
//   anything else     → that URL, without a trailing slash
export function resolveApiUrl(value, { dev }) {
  if (value === undefined) return dev ? 'http://localhost:4100' : ''
  return value.trim().replace(/\/+$/, '')
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL, { dev: import.meta.env.DEV })
