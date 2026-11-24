import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { createConversation, listConversations } from '@/api/endpoints'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { ChatThread } from './ChatThread'

export function ChatPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const [convs, setConvs] = useState({ status: 'loading', items: [], error: null })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const load = useCallback(() => {
    listConversations()
      .then(({ conversations }) => setConvs({ status: 'ready', items: conversations, error: null }))
      .catch((error) => setConvs((c) => ({ ...c, status: 'error', error })))
  }, [])

  useEffect(load, [load])

  async function newChat() {
    setCreating(true)
    setCreateError(null)
    try {
      const { conversation } = await createConversation()
      setConvs((c) => ({ status: 'ready', items: [conversation, ...c.items], error: null }))
      navigate(`/chat/${conversation.id}`)
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const selected = conversationId ? Number(conversationId) : null

  return (
    <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="grid gap-3 content-start">
        <h1 className="text-xl font-semibold">Chat</h1>
        <Button onClick={newChat} disabled={creating} data-testid="new-chat">
          <Plus aria-hidden /> {creating ? 'Creating…' : 'New chat'}
        </Button>
        {createError && (
          <Alert variant="destructive">
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        )}
        {convs.status === 'error' ? (
          <Alert variant="destructive">
            <AlertDescription>{convs.error.message}</AlertDescription>
          </Alert>
        ) : convs.status === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : convs.items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="conversation-list-empty">
            No conversations yet. Start one to ask about your spending.
          </p>
        ) : (
          <ul className="grid gap-1 max-h-[60svh] overflow-y-auto" data-testid="conversation-list">
            {convs.items.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/chat/${c.id}`}
                  data-testid="conversation-item"
                  aria-current={c.id === selected ? 'page' : undefined}
                  className={cn(
                    'block truncate rounded-md px-3 py-2 text-sm hover:bg-muted',
                    c.id === selected && 'bg-accent font-medium',
                  )}
                >
                  {c.title ?? <span className="text-muted-foreground">New chat</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section aria-label="Conversation" className="min-w-0">
        {selected ? (
          <ChatThread key={selected} conversationId={selected} onActivity={load} />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Start a new chat, or pick one from the list. Try: “How much did I spend in October?”
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
