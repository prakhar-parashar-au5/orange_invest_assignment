import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { API_URL } from './config'
import { ApiError, request, getHealth } from './client'

const url = (p) => `${API_URL}/api${p}`

describe('request()', () => {
  it('calls the API base URL with credentials included', async () => {
    // Node's fetch drops `credentials` from the Request object, so check what we pass to fetch.
    const spy = vi.spyOn(globalThis, 'fetch')
    server.use(http.get(url('/ping'), () => HttpResponse.json({ pong: true })))
    await expect(request('/ping')).resolves.toEqual({ pong: true })
    const [calledUrl, init] = spy.mock.calls[0]
    expect(calledUrl).toBe('http://localhost:4100/api/ping')
    expect(init.credentials).toBe('include')
  })

  it('drops empty query values and encodes the rest', async () => {
    let seen
    server.use(
      http.get(url('/q'), ({ request }) => {
        seen = new URL(request.url).search
        return HttpResponse.json({})
      }),
    )
    await request('/q', { query: { category: 'Food delivery', direction: '', page: 2, to: undefined } })
    expect(seen).toBe('?category=Food+delivery&page=2')
  })

  it('sends a JSON body with the JSON content type', async () => {
    let body, type
    server.use(
      http.post(url('/echo'), async ({ request }) => {
        type = request.headers.get('content-type')
        body = await request.json()
        return HttpResponse.json({ ok: true }, { status: 201 })
      }),
    )
    await request('/echo', { method: 'POST', body: { email: 'a@example.com' } })
    expect(type).toMatch(/application\/json/)
    expect(body).toEqual({ email: 'a@example.com' })
  })

  it('returns null for 204 No Content', async () => {
    server.use(http.post(url('/empty'), () => new HttpResponse(null, { status: 204 })))
    await expect(request('/empty', { method: 'POST' })).resolves.toBeNull()
  })

  it('turns the contract error shape into an ApiError with status, code and message', async () => {
    server.use(
      http.get(url('/broken'), () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'email is required' } },
          { status: 400 },
        ),
      ),
    )
    const err = await request('/broken').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'email is required' })
  })

  it('falls back to a generic error when the body is not the contract shape', async () => {
    server.use(http.get(url('/html'), () => new HttpResponse('<h1>Bad gateway</h1>', { status: 502 })))
    const err = await request('/html').catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502' })
  })

  it('reports a network failure as NETWORK_ERROR', async () => {
    server.use(http.get(url('/down'), () => HttpResponse.error()))
    const err = await request('/down').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })
})

describe('getHealth()', () => {
  it('returns the health body', async () => {
    await expect(getHealth()).resolves.toEqual({ status: 'ok' })
  })
})
