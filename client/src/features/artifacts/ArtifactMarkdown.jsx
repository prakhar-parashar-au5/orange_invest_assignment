import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ARTIFACTS_DIR, isExternalOrAnchor, repoUrl } from '@/lib/repoLinks'
import { MermaidBlock } from './MermaidBlock'

// Renders artifact markdown as untrusted text: react-markdown with raw HTML off (no rehype-raw),
// its default URL sanitiser (drops javascript: etc.), GFM tables, and our own link handling.

function Link({ href, children }) {
  if (href && href.startsWith('#')) return <a href={href} className="text-primary hover:underline">{children}</a>
  // Relative links point at repo files (the server doesn't serve them), so send them to GitHub.
  const target = href && !isExternalOrAnchor(href) ? repoUrl(href, ARTIFACTS_DIR) : href
  if (!target) return <span>{children}</span>
  return (
    <a href={target} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  )
}

function Pre({ node, children }) {
  const code = node?.children?.[0]
  const cls = code?.properties?.className || []
  if (code?.tagName === 'code' && cls.includes('language-mermaid')) {
    const source = (code.children || []).map((c) => c.value || '').join('').trim()
    return <MermaidBlock source={source} />
  }
  return <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{children}</pre>
}

const components = {
  a: Link,
  pre: Pre,
  h1: ({ children }) => <h1 className="mb-3 text-2xl font-semibold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-8 mb-2 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-2 font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-4 pl-3 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b px-2 py-1.5 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-2 py-1.5 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6" />,
}

export function ArtifactMarkdown({ markdown }) {
  return (
    <div className="text-sm" data-testid="artifact-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown || ''}
      </ReactMarkdown>
    </div>
  )
}
