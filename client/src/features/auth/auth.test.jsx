import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderApp } from '../../test/render'
import { API_URL } from '../../api/config'
import { seedUser } from '../../mocks/db'

describe('route guard', () => {
  it('sends a logged-out user to the login screen', async () => {
    renderApp('/uploads')
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /uploads/i })).not.toBeInTheDocument()
  })

  it('also guards the chat screen', async () => {
    renderApp('/chat')
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument()
  })

  it('lets a logged-in user straight in, decided by /me', async () => {
    renderApp('/uploads', { as: 'asha@example.com' })
    expect(await screen.findByRole('heading', { name: /uploads/i })).toBeInTheDocument()
    expect(screen.getByTestId('current-user')).toHaveTextContent('asha@example.com')
  })
})

describe('login flow', () => {
  it('logs in with an email, then logs out', async () => {
    const { ui } = renderApp('/')
    await ui.type(await screen.findByLabelText(/email/i), 'Asha@Example.com ')
    await ui.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('heading', { name: /uploads/i })).toBeInTheDocument()
    expect(screen.getByTestId('current-user')).toHaveTextContent('asha@example.com')

    await ui.click(screen.getByRole('button', { name: /log out/i }))
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument()
  })

  it('has only an email field and sends just the email; a 401 shows the server message on the form', async () => {
    const bodies = []
    server.use(
      http.post(`${API_URL}/api/auth/login`, async ({ request }) => {
        const body = await request.json()
        bodies.push(body)
        if (bodies.length === 1) {
          return HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login failed' } }, { status: 401 })
        }
        // Log the mock user in too, so the app's next calls (/uploads) are authenticated.
        return HttpResponse.json({ user: seedUser(body.email, { login: true }) })
      }),
    )
    const { ui, container } = renderApp('/login')
    await screen.findByLabelText(/^email/i)
    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).toBeNull()

    await ui.type(screen.getByLabelText(/^email/i), 'admin@test.local')
    await ui.click(screen.getByRole('button', { name: /log in/i }))
    // A 401 from login is shown on the form, not treated as an expired session.
    expect(await screen.findByRole('alert')).toHaveTextContent('Login failed')

    await ui.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('heading', { name: /uploads/i })).toBeInTheDocument()
    expect(bodies).toEqual([{ email: 'admin@test.local' }, { email: 'admin@test.local' }])
  })

  it('shows the server validation message', async () => {
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'email must be a valid email' } },
          { status: 400 },
        ),
      ),
    )
    const { ui } = renderApp('/login')
    await ui.type(await screen.findByLabelText(/email/i), 'x@y.co')
    await ui.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('email must be a valid email')
  })

  it('returns to login when the session expires mid-use', async () => {
    server.use(
      http.get(`${API_URL}/api/uploads`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Log in again.' } }, { status: 401 }),
      ),
    )
    renderApp('/uploads', { as: 'asha@example.com' })
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument()
  })
})

describe('API status', () => {
  it('shows "API: ok" when health responds', async () => {
    renderApp('/login')
    expect(await screen.findByText('API: ok')).toBeInTheDocument()
  })

  it('shows "API: unreachable" when health fails', async () => {
    server.use(http.get(`${API_URL}/api/health`, () => HttpResponse.error()))
    renderApp('/login')
    expect(await screen.findByText('API: unreachable')).toBeInTheDocument()
  })
})
