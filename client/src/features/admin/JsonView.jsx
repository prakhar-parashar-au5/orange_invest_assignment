import { useState } from 'react'

// Collapsed by default. The JSON is only stringified and rendered once the admin opens it,
// so a page with many large tool results stays cheap.
export function JsonView({ label, value }) {
  const [open, setOpen] = useState(false)
  if (value === null || value === undefined) {
    return <div className="text-xs text-muted-foreground">{label}: none</div>
  }
  return (
    <details className="text-xs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">{label}</summary>
      {open && (
        <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </details>
  )
}
