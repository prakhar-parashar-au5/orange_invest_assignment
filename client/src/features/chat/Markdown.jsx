import { Fragment } from 'react'

// Renders the "simple markdown" the contract allows in assistant messages: paragraphs, line breaks,
// bullet and numbered lists, **bold**. Builds React elements (never innerHTML), so model output
// can't inject markup.

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

function inline(text, keyBase) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    ),
  )
}

function toBlocks(text) {
  const blocks = []
  for (const line of text.split(/\r?\n/)) {
    const bullet = BULLET.exec(line)
    const numbered = !bullet && NUMBERED.exec(line)
    const last = blocks[blocks.length - 1]
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol'
      const item = (bullet || numbered)[1]
      if (last?.type === type) last.items.push(item)
      else blocks.push({ type, items: [item] })
    } else if (line.trim() === '') {
      blocks.push({ type: 'break' })
    } else if (last?.type === 'p') {
      last.lines.push(line)
    } else {
      blocks.push({ type: 'p', lines: [line] })
    }
  }
  return blocks.filter((b) => b.type !== 'break')
}

export function Markdown({ text }) {
  return (
    <div className="grid gap-2">
      {toBlocks(text || '').map((b, i) => {
        if (b.type === 'p') {
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l, `${i}-${j}`)}
                </Fragment>
              ))}
            </p>
          )
        }
        const List = b.type
        return (
          <List key={i} className={List === 'ul' ? 'list-disc pl-5 grid gap-0.5' : 'list-decimal pl-5 grid gap-0.5'}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, `${i}-${j}`)}</li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
