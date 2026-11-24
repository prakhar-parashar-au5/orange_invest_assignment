import { useEffect, useId, useState } from 'react'
import { loadMermaid } from '@/lib/loadMermaid'

// Draws one ```mermaid``` block. Mermaid is loaded on first use (separate chunk) with
// securityLevel 'strict'. Its SVG output is the only HTML this app injects. If parsing or
// rendering fails, the diagram source is shown as a code block instead.
export function MermaidBlock({ source }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [state, setState] = useState({ status: 'loading', svg: null })

  useEffect(() => {
    let alive = true
    loadMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg }) => alive && setState({ status: 'ready', svg }))
      .catch(() => {
        // Mermaid leaves an error element in <body> on failure; tidy it up.
        document.getElementById(`d${id}`)?.remove()
        if (alive) setState({ status: 'error', svg: null })
      })
    return () => {
      alive = false
    }
  }, [id, source])

  if (state.status === 'ready') {
    return (
      <div
        className="my-3 overflow-x-auto rounded-md border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        data-testid="mermaid-diagram"
        // Mermaid strict-mode output only (see loadMermaid.js). Nothing else uses innerHTML.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <figure className="my-3 grid gap-1" data-testid="mermaid-fallback">
        <figcaption className="text-xs text-muted-foreground">This diagram couldn't be drawn. Its source:</figcaption>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{source}</code>
        </pre>
      </figure>
    )
  }
  return (
    <div className="my-3 rounded-md border p-6 text-center text-xs text-muted-foreground" role="status">
      Drawing diagram…
    </div>
  )
}
