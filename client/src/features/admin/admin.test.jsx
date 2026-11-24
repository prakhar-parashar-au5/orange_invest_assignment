import { describe, it, expect } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderApp } from '../../test/render'
import { API_URL } from '../../api/config'
import { db } from '../../mocks/db'

const ADMIN = 'admin@test.local'
const api = (p) => `${API_URL}/api${p}`

describe('admin gating', () => {
  it('hides the Admin nav for a normal user and renders the backend 403 on admin routes', async () => {
    renderApp('/uploads', { as: 'a@test.local' })
    await screen.findByRole('heading', { name: /uploads/i })
    expect(screen.queryByTestId('nav-admin')).not.toBeInTheDocument()

    renderApp('/admin/ai', { as: 'a@test.local' })
    expect(await screen.findByTestId('admin-forbidden')).toHaveTextContent(/admin/i)
  })

  it('shows the Admin nav for an admin', async () => {
    renderApp('/uploads', { as: ADMIN })
    expect(await screen.findByTestId('nav-admin')).toHaveAttribute('href', '/admin/ai')
  })

  it('renders 503 with the server message', async () => {
    server.use(
      http.get(api('/admin/ai/summary'), () =>
        HttpResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace store is down.' } }, { status: 503 }),
      ),
    )
    renderApp('/admin/ai', { as: ADMIN })
    expect(await screen.findByTestId('admin-error')).toHaveTextContent('Trace store is down.')
  })
})

describe('AI overview', () => {
  it('renders the summary numbers and links counts to filtered traces', async () => {
    const { ui } = renderApp('/admin/ai', { as: ADMIN })

    // Seeded mock: 3 traces, 2 succeeded, 1 failed (model stage).
    const status = await screen.findByTestId('summary-status')
    expect(within(status).getByRole('link', { name: /succeeded\s*2/i })).toHaveAttribute(
      'href',
      expect.stringContaining('status=SUCCEEDED'),
    )
    expect(within(status).getByRole('link', { name: /failed\s*1/i })).toHaveAttribute(
      'href',
      expect.stringContaining('status=FAILED'),
    )
    expect(screen.getByTestId('summary-failure-rate')).toHaveTextContent('33.3%')
    // Finished latencies 640, 2841, 6120 → p50 2841, p95 6120.
    expect(screen.getByTestId('summary-latency')).toHaveTextContent('2.84 s')
    expect(screen.getByTestId('summary-latency')).toHaveTextContent('6.12 s')
    expect(screen.getByTestId('summary-tokens')).toHaveTextContent('8,320')

    const tools = screen.getByTestId('summary-tools')
    const listRow = within(tools).getByRole('link', { name: 'list_transactions' })
    expect(listRow).toHaveAttribute('href', expect.stringContaining('tool=list_transactions'))
    expect(within(listRow.closest('tr')).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'list_transactions', '2', '0', '1',
    ])

    expect(screen.getByTestId('summary-reviews')).toHaveTextContent(/good\s*1/i)
    expect(screen.getByTestId('summary-chart')).toBeInTheDocument()

    // Switching the window refetches.
    let asked
    server.use(
      http.get(api('/admin/ai/summary'), ({ request }) => {
        asked = new URL(request.url).searchParams.get('window')
        return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'stop here' } }, { status: 400 })
      }),
    )
    await ui.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(asked).toBe('7d'))
  })
})

describe('trace list', () => {
  it('reads filters from the URL and shows no message content', async () => {
    renderApp('/admin/ai/traces?status=FAILED', { as: ADMIN })
    const rows = await screen.findAllByTestId('trace-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('FAILED')
    expect(rows[0]).toHaveTextContent('model · 429')
    expect(screen.getByLabelText(/status/i)).toHaveValue('FAILED')
    expect(screen.queryByText('Top 5 merchants this year')).not.toBeInTheDocument()
  })

  it('updates the URL when a filter changes', async () => {
    const { ui } = renderApp('/admin/ai/traces', { as: ADMIN })
    expect(await screen.findAllByTestId('trace-row')).toHaveLength(3)
    await ui.type(screen.getByLabelText(/tool/i), 'top_merchants')
    await ui.click(screen.getByRole('button', { name: /apply/i }))
    await waitFor(() => expect(screen.getAllByTestId('trace-row')).toHaveLength(1))
    expect(screen.getByTestId('trace-row')).toHaveTextContent('b@test.local')
  })
})

describe('trace detail', () => {
  it('shows the timeline in order: prompt → model → tools → answer', async () => {
    renderApp('/admin/ai/traces/43', { as: ADMIN })
    const steps = await screen.findAllByTestId('timeline-step')
    expect(steps.map((s) => s.dataset.kind)).toEqual([
      'user', 'model_call', 'tool_call', 'model_call', 'tool_call', 'tool_call', 'model_call', 'answer',
    ])
    expect(steps[2]).toHaveTextContent('list_transactions')
    expect(steps[2]).toHaveTextContent('REJECTED')
    expect(steps[2]).toHaveTextContent('INVALID_ARGS')
    expect(steps[1]).toHaveTextContent('tool_calls')
    expect(screen.queryByTestId('stopped-here')).not.toBeInTheDocument()

    // JSON stays collapsed until opened.
    const args = within(steps[2]).getByText(/arguments/i).closest('details')
    expect(args).not.toHaveAttribute('open')
    expect(within(args).queryByText(/five thousand/)).not.toBeInTheDocument()
  })

  it('marks where a failed turn stopped', async () => {
    renderApp('/admin/ai/traces/42', { as: ADMIN })
    const stop = await screen.findByTestId('stopped-here')
    expect(stop).toHaveTextContent(/stopped here/i)
    expect(stop).toHaveTextContent('model')
    expect(stop).toHaveTextContent('429')
    expect(stop).toHaveTextContent('RateLimitError')
    const kinds = screen.getAllByTestId('timeline-step').map((s) => s.dataset.kind)
    expect(kinds).toEqual(['user', 'model_call'])
    expect(screen.getByRole('link', { name: /previous turn/i })).toHaveAttribute('href', '/admin/ai/traces/41')
    expect(screen.getByRole('link', { name: /next turn/i })).toHaveAttribute('href', '/admin/ai/traces/43')
  })

  it('saves a review with the version it last saw', async () => {
    let sent
    server.use(
      http.put(api('/admin/ai/traces/:id/review'), async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({
          review: { verdict: 'bad', note: sent.note, reviewer_id: 1, version: 2, updated_at: '2026-11-24T23:50:00+05:30' },
        })
      }),
    )
    const { ui } = renderApp('/admin/ai/traces/41', { as: ADMIN })
    const panel = await screen.findByTestId('review-panel')
    await ui.click(within(panel).getByLabelText(/^bad$/i))
    await ui.clear(within(panel).getByLabelText(/note/i))
    await ui.type(within(panel).getByLabelText(/note/i), 'Wrong month.')
    await ui.click(within(panel).getByRole('button', { name: /save review/i }))
    expect(await within(panel).findByText(/saved/i)).toBeInTheDocument()
    expect(sent).toEqual({ verdict: 'bad', note: 'Wrong month.', expectedVersion: 1 })
  })

  it('handles 409 STALE_REVIEW: tells the admin, reloads, and lets them retry', async () => {
    const { ui } = renderApp('/admin/ai/traces/41', { as: ADMIN })
    const panel = await screen.findByTestId('review-panel')

    // Someone else saves version 2 while this admin is looking at version 1.
    const tr = db().admin.traces.find((x) => x.row.id === 41)
    tr.review = { verdict: 'needs_fix', note: 'Other admin note', reviewer_id: 9, version: 2, updated_at: '2026-11-24T23:55:00+05:30' }

    await ui.click(within(panel).getByLabelText(/^bad$/i))
    await ui.click(within(panel).getByRole('button', { name: /save review/i }))

    expect(await within(panel).findByTestId('review-stale')).toHaveTextContent(/someone else/i)
    // Reloaded: the other admin's note is now shown.
    await waitFor(() => expect(within(panel).getByLabelText(/note/i)).toHaveValue('Other admin note'))

    await ui.click(within(panel).getByLabelText(/^bad$/i))
    await ui.click(within(panel).getByRole('button', { name: /save review/i }))
    expect(await within(panel).findByText(/saved/i)).toBeInTheDocument()
    expect(tr.review).toMatchObject({ verdict: 'bad', version: 3 })
  })

  it('deletes a trace after an inline confirmation', async () => {
    const { ui } = renderApp('/admin/ai/traces/41', { as: ADMIN })
    await ui.click(await screen.findByRole('button', { name: /delete trace/i }))
    expect(db().admin.traces.some((x) => x.row.id === 41)).toBe(true)
    await ui.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() => expect(db().admin.traces.some((x) => x.row.id === 41)).toBe(false))
    expect(await screen.findAllByTestId('trace-row')).toHaveLength(2)
  })

  it('shows not found for an unknown trace', async () => {
    renderApp('/admin/ai/traces/999', { as: ADMIN })
    expect(await screen.findByTestId('admin-error')).toHaveTextContent(/not found/i)
  })
})

describe('evals', () => {
  it('lists runs with pass / fail / blocked', async () => {
    renderApp('/admin/evals', { as: ADMIN })
    const rows = await screen.findAllByTestId('eval-run-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('after prompt tweak')
    expect(rows[0]).toHaveTextContent('1 / 1 / 0')
    expect(rows[1]).toHaveTextContent('BLOCKED')
  })

  it('shows a run as a table of cases with gates, attempts and trace links', async () => {
    renderApp('/admin/evals/3', { as: ADMIN })
    const cases = await screen.findAllByTestId('eval-case')
    expect(cases).toHaveLength(2)

    expect(cases[0]).toHaveTextContent('golden-01-october')
    expect(cases[0]).toHaveTextContent('1/1')
    expect(within(cases[0]).getAllByTestId('gate-pass')).toHaveLength(5)
    expect(within(cases[0]).queryByTestId('gate-fail')).not.toBeInTheDocument()
    expect(within(cases[0]).getByRole('link', { name: /trace 41/i })).toHaveAttribute('href', '/admin/ai/traces/41')

    expect(cases[1]).toHaveTextContent('2/3 (67%)')
    const fail = within(cases[1]).getByTestId('gate-fail')
    expect(fail).toHaveTextContent('numbers_exact')
    expect(fail).toHaveAttribute('title', 'expected 4 rows: found 3')
    expect(cases[1]).toHaveTextContent('Here are 3 transactions above ₹5,000')
  })
})
