// The only place Mermaid is imported. It's a dynamic import, so Mermaid (large) becomes its own
// chunk, fetched only when an artifacts page actually contains a diagram.
let ready

export function loadMermaid() {
  ready ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // strict: no HTML labels, no click handlers or scripts in diagrams, output sanitised.
      securityLevel: 'strict',
      theme: 'neutral',
      // Mermaid 12's built-in default is layout "elk", which lazy-loads a 1.5 MB layout engine.
      // Our diagrams (flowchart, erDiagram) are fine with dagre. vite.config.js also stubs ELK
      // out of the build, so a diagram that asks for ELK fails and shows its source instead.
      layout: 'dagre',
    })
    return mermaid
  })
  return ready
}
