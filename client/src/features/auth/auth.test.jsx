import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderApp } from '../../test/render'
import { API_URL } from '../../api/config'

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
