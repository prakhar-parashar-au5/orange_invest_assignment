import { describe, it, expect, vi } from 'vitest'

const initialize = vi.fn()
vi.mock('mermaid', () => ({ default: { initialize, render: vi.fn() } }))

describe('loadMermaid', () => {
  it('initialises Mermaid in strict mode with the dagre layout, never ELK', async () => {
    const { loadMermaid } = await import('./loadMermaid')
    await loadMermaid()
    expect(initialize).toHaveBeenCalledTimes(1)
    const config = initialize.mock.calls[0][0]
    expect(config).toMatchObject({ securityLevel: 'strict', startOnLoad: false, layout: 'dagre' })
    expect(JSON.stringify(config)).not.toMatch(/elk/i)
  })
})
