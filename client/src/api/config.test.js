import { afterEach, describe, it, expect, vi } from 'vitest'
import { resolveApiUrl } from './config'

describe('resolveApiUrl', () => {
  it('treats an empty VITE_API_URL as same origin', () => {
    expect(resolveApiUrl('', { dev: true })).toBe('')
    expect(resolveApiUrl('', { dev: false })).toBe('')
    expect(resolveApiUrl('   ', { dev: false })).toBe('')
  })

  it('falls back to localhost:4100 only when the variable is undefined in dev', () => {
    expect(resolveApiUrl(undefined, { dev: true })).toBe('http://localhost:4100')
    expect(resolveApiUrl(undefined, { dev: false })).toBe('')
  })

  it('uses an explicit URL without a trailing slash', () => {
    expect(resolveApiUrl('https://api.example.com/', { dev: false })).toBe('https://api.example.com')
  })
})

describe('request() with an empty VITE_API_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('calls a relative /api path', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()
    const { getHealth } = await import('./client')
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    await expect(getHealth()).resolves.toEqual({ status: 'ok' })
    expect(spy.mock.calls[0][0]).toBe('/api/health')
  })
})
