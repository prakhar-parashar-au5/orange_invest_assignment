import { useEffect, useRef, useState } from 'react'
import { getMessages, sendMessage } from '@/api/endpoints'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

const MAX_CHARS = 2000 // contract: text is 1–2,000 characters after trimming

function Bubble({ role, children }) {
  const user = role === 'user'
  return (
    <div data-testid="chat-message" data-role={role} className={cn('flex', user ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          user ? 'bg-primary text-primary-foreground whitespace-pre-wrap' : 'bg-muted',
        )}
      >
        <span className="sr-only">{user ? 'You: ' : 'Assistant: '}</span>
        {children}
      </div>
    </div>
  )
}

export function ChatThread({ conversationId, onActivity }) {
  const [load, setLoad] = useState({ status: 'loading', error: null })
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [sendError, setSendError] = useState(null) // { message, text, retryable }
  const endRef = useRef(null)

  useEffect(() => {
    let alive = true
    getMessages(conversationId)
      .then(({ messages: m }) => {
        if (!alive) return
        setMessages(m)
        setLoad({ status: 'ready', error: null })
      })
      .catch((error) => alive && setLoad({ status: 'error', error }))
    return () => {
      alive = false
    }
  }, [conversationId])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, pending, sendError])

  async function send(raw, { retry = false } = {}) {
    const q = raw.trim()
    if (!q || q.length > MAX_CHARS || pending) return
    setSendError(null)
    setPending(true)
    const tempId = `temp-${Date.now()}`
    if (!retry) {
      setMessages((m) => [...m, { id: tempId, role: 'user', content: q }])
      setText('')
    }
    try {
      const { user_message, assistant_message } = await sendMessage(conversationId, q)
      setMessages((m) => {
        // Swap the optimistic user message (or, on retry, the last one) for the stored one.
        const idx = retry ? m.findLastIndex((x) => x.role === 'user') : m.findIndex((x) => x.id === tempId)
        const next = [...m]
        if (idx >= 0) next[idx] = user_message
        else next.push(user_message)
        return [...next, assistant_message]
      })
      onActivity?.()
    } catch (err) {
      if (err.code === 'VALIDATION_ERROR') {
        // Nothing was stored. Put the text back so the user can fix it.
        if (!retry) {
          setMessages((m) => m.filter((x) => x.id !== tempId))
          setText(q)
        }
        setSendError({ message: err.message, text: q, retryable: false })
      } else {
        // AGENT_UNAVAILABLE: the user message is stored server-side; keep it and offer a resend.
        setSendError({ message: err.message, text: q, retryable: true })
        onActivity?.()
      }
    } finally {
      setPending(false)
    }
  }

  if (load.status === 'error') {
    return (
      <Alert variant="destructive" data-testid="chat-load-error">
        <AlertDescription>
          {load.error.code === 'NOT_FOUND' ? 'Conversation not found.' : load.error.message}
        </AlertDescription>
      </Alert>
    )
  }

  const trimmed = text.trim()
  const tooLong = trimmed.length > MAX_CHARS

  return (
    <Card className="flex h-[calc(100svh-10rem)] min-h-96 flex-col gap-0 py-0">
      <CardContent className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3" data-testid="chat-thread" aria-live="polite">
          {load.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
          {load.status === 'ready' && messages.length === 0 && !pending && (
            <p className="text-sm text-muted-foreground" data-testid="chat-empty">
              Ask a question about your uploaded transactions, e.g. “Top 5 merchants this year”.
            </p>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            </Bubble>
          ))}
          {pending && (
            <div data-testid="chat-pending" role="status" className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground animate-pulse">
                Thinking… this can take up to 30 seconds.
              </div>
            </div>
          )}
          {sendError && (
            <Alert variant="destructive" data-testid="chat-error">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>{sendError.message}</span>
                {sendError.retryable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => send(sendError.text, { retry: true })}
                    data-testid="chat-retry"
                  >
                    Try again
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div ref={endRef} />
        </div>
      </CardContent>

      <form
        className="grid gap-2 border-t p-4"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <Label htmlFor="chat-input">Your question</Label>
        <div className="flex items-end gap-2">
          <textarea
            id="chat-input"
            data-testid="chat-input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(text)
              }
            }}
            placeholder="How much did I spend on food delivery last month?"
            aria-invalid={tooLong || undefined}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-10 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] aria-invalid:border-destructive"
          />
          <Button type="submit" disabled={pending || !trimmed || tooLong} data-testid="chat-send">
            Send
          </Button>
        </div>
        <p className={cn('text-xs text-muted-foreground', tooLong && 'text-destructive')}>
          {tooLong
            ? `Too long: ${trimmed.length} / ${MAX_CHARS} characters.`
            : 'Enter to send, Shift+Enter for a new line.'}
        </p>
      </form>
    </Card>
  )
}
