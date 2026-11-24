// The only place Mermaid is imported. It's a dynamic import, so Mermaid (large) becomes its own
// chunk, fetched only when an artifacts page actually contains a diagram.
let ready

export function loadMermaid() {
  ready ??= import('mermaid').then(({ default: mermaid }) => {
    // strict: no HTML labels, no click handlers or scripts in diagrams, output sanitised.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
    return mermaid
  })
  return ready
}
