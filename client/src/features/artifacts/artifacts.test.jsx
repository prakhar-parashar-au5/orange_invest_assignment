import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderApp } from '../../test/render'
import { API_URL } from '../../api/config'
import { repoUrl } from '../../lib/repoLinks'

// Mermaid can't lay out SVG in jsdom, so the loader is mocked. Each test sets what render() does.
const render = vi.fn()
vi.mock('../../lib/loadMermaid', () => ({ loadMermaid: () => Promise.resolve({ render }) }))

const api = (p) => `${API_URL}/api${p}`
const GH = 'https://github.com/prakhar-parashar-au5/orange_invest_assignment/blob/main/'

function serveArtifact(markdown, data = null, name = 'requirements') {
  server.use(
    http.get(api(`/artifacts/${name}`), () =>
      HttpResponse.json({ name, title: 'Requirements and decisions', markdown, data }),
    ),
  )
}

beforeEach(() => {
  render.mockReset()
  render.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><g></g></svg>' })
})

describe('artifacts', () => {
  it('shows the Artifacts nav and the 4 pages as tabs in API order', async () => {
    renderApp('/uploads', { as: 'a@test.local' })
    expect(await screen.findByTestId('nav-artifacts')).toHaveAttribute('href', '/artifacts')

    renderApp('/artifacts', { as: 'a@test.local' })
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Requirements and decisions',
      'Architecture',
      'How it was built with AI agents',
      'Quality: tests, performance, evals',
    ])
    // /artifacts opens the first one.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { level: 1, name: 'Requirements and decisions' })).toBeInTheDocument()
  })

  it('renders markdown tables and turns relative repo links into GitHub links', async () => {
    renderApp('/artifacts/requirements', { as: 'a@test.local' })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'decision' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: 'Money in integer paise' })).toBeInTheDocument()

    const spec = screen.getByRole('link', { name: 'SPEC' })
    expect(spec).toHaveAttribute('href', `${GH}docs/spec.md`)
    expect(spec).toHaveAttribute('target', '_blank')
    expect(spec).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Vite' })).toHaveAttribute('href', 'https://vite.dev')
  })

  it('hides HTML comments such as generated-section markers', async () => {
    serveArtifact('# Title\n\n<!-- generated:er -->\nGenerated 2026-11-25\n<!-- /generated:er -->\n\nText with an inline <!-- note --> comment.')
    const { container } = renderApp('/artifacts/requirements', { as: 'a@test.local' })
    await screen.findByRole('heading', { name: 'Title' })
    expect(container.textContent).not.toMatch(/generated:er|<!--|-->|note/)
    expect(screen.getByText(/Generated 2026-11-25/)).toBeInTheDocument()
    expect(screen.getByText(/Text with an inline/)).toBeInTheDocument()
  })

  it('does not render raw HTML from the markdown', async () => {
    serveArtifact('# Title\n\n<img src=x onerror="alert(1)"><b data-testid="raw-b">bold</b>\n\n<script>window.pwned=1</script>\n\n[js](javascript:alert(1))')
    const { container } = renderApp('/artifacts/requirements', { as: 'a@test.local' })
    await screen.findByRole('heading', { name: 'Title' })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.queryByTestId('raw-b')).not.toBeInTheDocument()
    expect(window.pwned).toBeUndefined()
    // The javascript: URL is dropped by react-markdown's URL sanitiser.
    const js = screen.queryByRole('link', { name: 'js' })
    if (js) expect(js.getAttribute('href') || '').not.toMatch(/^javascript:/i)
  })

  it('renders a mermaid block as an SVG', async () => {
    renderApp('/artifacts/architecture', { as: 'a@test.local' })
    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument()
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), expect.stringContaining('flowchart LR'))
  })

  it('shows the source when a mermaid block fails to render', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'))
    renderApp('/artifacts/architecture', { as: 'a@test.local' })
    const fallback = await screen.findByTestId('mermaid-fallback')
    expect(fallback).toHaveTextContent('flowchart LR')
    expect(fallback).toHaveTextContent(/couldn't be drawn/i)
    expect(screen.queryByTestId('mermaid-svg')).not.toBeInTheDocument()
  })

  it('shows the architecture data panels: schema tables and the request flow', async () => {
    const { ui } = renderApp('/artifacts/architecture', { as: 'a@test.local' })
    const schema = await screen.findByTestId('schema-panel')
    const txn = within(schema).getByText('transactions').closest('details')
    expect(txn).not.toHaveAttribute('open')
    await ui.click(within(txn).getByText('transactions'))
    const row = within(txn).getByRole('row', { name: /upload_id/ })
    expect(row).toHaveTextContent('bigint unsigned')
    expect(row).toHaveTextContent('MUL')
    expect(row).toHaveTextContent('uploads.id')

    const steps = within(screen.getByTestId('flow-panel')).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveTextContent('User presses Send')
    expect(within(steps[0]).getByRole('link', { name: 'client/src/features/chat/ChatThread.jsx' })).toHaveAttribute(
      'href',
      `${GH}client/src/features/chat/ChatThread.jsx`,
    )
  })

  it('shows the quality data panels', async () => {
    renderApp('/artifacts/quality', { as: 'a@test.local' })
    const layers = await screen.findByTestId('quality-layers')
    expect(within(layers).getByRole('row', { name: /server unit/ })).toHaveTextContent('184')
    const perf = screen.getByTestId('quality-performance')
    const row = within(perf).getByRole('row', { name: /trace summary/ })
    expect(row).toHaveTextContent('idx_trace_status_created')
    expect(row).toHaveTextContent('3.27')
    expect(row).toHaveTextContent('3.98')
    expect(within(screen.getByTestId('quality-evals')).getByText('BLOCKED')).toBeInTheDocument()
  })

  it('shows not found for an unknown page', async () => {
    renderApp('/artifacts/nope', { as: 'a@test.local' })
    expect(await screen.findByTestId('artifact-error')).toHaveTextContent(/not found/i)
    expect(within(screen.getByTestId('artifact-error')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows other errors with a retry', async () => {
    let calls = 0
    server.use(
      http.get(api('/artifacts/quality'), () => {
        calls++
        return calls === 1
          ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }, { status: 500 })
          : HttpResponse.json({ name: 'quality', title: 'Quality', markdown: '# Recovered', data: null })
      }),
    )
    const { ui } = renderApp('/artifacts/quality', { as: 'a@test.local' })
    const err = await screen.findByTestId('artifact-error')
    expect(err).toHaveTextContent('Something went wrong.')
    await ui.click(within(err).getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: 'Recovered' })).toBeInTheDocument()
  })

  it('sends a logged-out user to login', async () => {
    renderApp('/artifacts/architecture')
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument()
  })
})

describe('repoUrl', () => {
  it('resolves paths relative to the artifacts folder and refuses to climb out of the repo', () => {
    expect(repoUrl('../../server/src/app.js', 'docs/artifacts/')).toBe(`${GH}server/src/app.js`)
    expect(repoUrl('schema.json', 'docs/artifacts/')).toBe(`${GH}docs/artifacts/schema.json`)
    expect(repoUrl('../deploy/runbook.md#step-2', 'docs/artifacts/')).toBe(`${GH}docs/deploy/runbook.md#step-2`)
    expect(repoUrl('client/src/App.jsx')).toBe(`${GH}client/src/App.jsx`)
    expect(repoUrl('../../../etc/passwd', 'docs/artifacts/')).toBeNull()
  })
})
