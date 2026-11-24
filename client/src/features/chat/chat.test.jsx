import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderApp } from '../../test/render'
import { API_URL } from '../../api/config'
import { db, nextId, nowIso, seedUser } from '../../mocks/db'

function seedConversation(userId, title, messages = []) {
  const s = db()
  const conv = { id: nextId(), user_id: userId, title, created_at: nowIso(), updated_at: nowIso() }
  s.conversations.push(conv)
  for (const [role, content] of messages) {
    s.messages.push({ id: nextId(), conversation_id: conv.id, role, content, created_at: nowIso() })
  }
  return conv
}

describe('chat', () => {
  it('shows an empty state with a new chat button', async () => {
    renderApp('/chat', { as: 'asha@example.com' })
    expect(await screen.findByText(/no conversations yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
  })

  it('starts a new chat, shows a pending state, then the reply', async () => {
    // Hold the reply until the test releases it, so the pending state is observable.
    let release
    const gate = new Promise((r) => (release = r))
    server.use(
      http.post(`${API_URL}/api/conversations/:id/messages`, async ({ request }) => {
        const { text } = await request.json()
        await gate
        return HttpResponse.json(
          {
            user_message: { id: 501, role: 'user', content: text, created_at: nowIso() },
            assistant_message: {
              id: 502,
              role: 'assistant',
              content: 'You spent **₹42,310.50** in October 2026.',
              created_at: nowIso(),
            },
          },
          { status: 201 },
        )
      }),
    )

    const { ui } = renderApp('/chat', { as: 'asha@example.com' })
    await ui.click(await screen.findByRole('button', { name: /new chat/i }))
    const box = await screen.findByLabelText(/your question/i)
    await ui.type(box, 'How much did I spend in October?')
    await ui.click(screen.getByRole('button', { name: /send/i }))

    const thread = screen.getByTestId('chat-thread')
    expect(within(thread).getByText('How much did I spend in October?')).toBeInTheDocument()
    expect(await within(thread).findByTestId('chat-pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()

    release()
    const reply = await within(thread).findByText(/in October 2026/)
    expect(reply.closest('[data-role="assistant"]')).toBeInTheDocument()
    expect(within(thread).getByText('₹42,310.50').tagName).toBe('STRONG')
    expect(within(thread).queryByTestId('chat-pending')).not.toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  it('titles the conversation in the list after the first message', async () => {
    const { ui } = renderApp('/chat', { as: 'asha@example.com' })
    await ui.click(await screen.findByRole('button', { name: /new chat/i }))
    await ui.type(await screen.findByLabelText(/your question/i), 'Top 5 merchants this year{Enter}')
    await screen.findByText(/mock reply/i)
    expect(await within(screen.getByTestId('conversation-list')).findByText('Top 5 merchants this year')).toBeInTheDocument()
  })

  it('shows an agent failure inline and lets the user try again', async () => {
    const { ui } = renderApp('/chat', { as: 'asha@example.com' })
    await ui.click(await screen.findByRole('button', { name: /new chat/i }))
    await ui.type(await screen.findByLabelText(/your question/i), 'please fail{Enter}')

    const error = await screen.findByTestId('chat-error')
    expect(error).toHaveTextContent(/assistant is unavailable/i)
    // The server stored the user message, so it stays in the thread.
    expect(within(screen.getByTestId('chat-thread')).getByText('please fail')).toBeInTheDocument()

    server.use(
      http.post(`${API_URL}/api/conversations/:id/messages`, async ({ request }) => {
        const { text } = await request.json()
        return HttpResponse.json(
          {
            user_message: { id: 601, role: 'user', content: text, created_at: nowIso() },
            assistant_message: { id: 602, role: 'assistant', content: 'Recovered answer', created_at: nowIso() },
          },
          { status: 201 },
        )
      }),
    )
    await ui.click(within(error).getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Recovered answer')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument()
  })

  it('opens an existing conversation with its messages in order', async () => {
    const user = seedUser('asha@example.com', { login: true })
    seedConversation(user.id, 'Food in October', [
      ['user', 'How much on food delivery last month?'],
      ['assistant', 'You spent:\n- Swiggy: ₹1,200.00\n- Zomato: ₹800.00'],
    ])
    const { ui } = renderApp('/chat')
    await ui.click(await screen.findByText('Food in October'))

    const thread = screen.getByTestId('chat-thread')
    const msgs = await within(thread).findAllByTestId('chat-message')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toHaveAttribute('data-role', 'user')
    expect(within(msgs[1]).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Swiggy: ₹1,200.00',
      'Zomato: ₹800.00',
    ])
  })

  it('shows not found for a conversation that is not yours', async () => {
    renderApp('/chat/9999', { as: 'asha@example.com' })
    expect(await screen.findByTestId('chat-load-error')).toHaveTextContent(/not found/i)
  })
})
