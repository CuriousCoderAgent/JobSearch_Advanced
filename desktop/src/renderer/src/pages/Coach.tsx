import { useEffect, useRef, useState } from 'react'
import { Eraser, Send } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { Markdown, Spinner } from '../components/ui'
import type { ChatMessage } from '../../../shared/types'

const STARTERS = [
  'Look at my pipeline — where am I most likely to get an offer, and what should I do this week?',
  'Grill me: ask me one tough VP-level interview question, then critique my answer.',
  'Help me decide between the IC Account Director path and a leadership role for my next move.',
  'What should my compensation ask be for a Head of Enterprise Sales role in Bangalore?',
  'Which of my interview answers are weakest right now, and why?'
]

export default function Coach() {
  const { state, patch, run } = useDesk()
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const chat = state.chat

  useEffect(() => onEvent('coach:delta', (d) => setStreaming((s) => (s ?? '') + String(d))), [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.length, streaming])

  const send = async (msg: string): Promise<void> => {
    const content = msg.trim()
    if (!content || streaming !== null) return
    setText('')
    patch((s) => ({ ...s, chat: [...s.chat, { role: 'user', content, at: new Date().toISOString() }] }))
    setStreaming('')
    const next = await run(() => call<ChatMessage[]>('coach:chat', content))
    if (next) patch((s) => ({ ...s, chat: next }))
    setStreaming(null)
  }
  const clear = async (): Promise<void> => {
    if (!window.confirm('Clear this conversation?')) return
    await run(() => call('coach:clear'))
    patch((s) => ({ ...s, chat: [] }))
  }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%', paddingBottom: 20, maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Coach</div>
          <div className="page-title">Your coach, fully briefed</div>
          <div className="page-sub">Knows your pipeline, your prepared answers and your latest practice scores. Ask anything.</div>
        </div>
        {chat.length > 0 && <button className="btn ghost sm" onClick={clear}><Eraser size={14} /> Clear</button>}
      </div>

      <div style={{ overflow: 'auto', paddingRight: 6 }}>
        {chat.length === 0 && streaming === null ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="muted small">Try one of these:</div>
            {STARTERS.map((s) => <div key={s} className="item clickable" onClick={() => send(s)}>{s}</div>)}
          </div>
        ) : (
          <div className="chat">
            {chat.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>
            ))}
            {streaming !== null && (
              <div className="bubble assistant">{streaming ? <Markdown text={streaming} /> : <span className="row muted"><Spinner size={14} /> Thinking about your situation…</span>}</div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={!state.hasKey}
          placeholder={state.hasKey ? 'Ask your coach… (Enter to send, Shift+Enter for a new line)' : 'Add your Anthropic key in Settings to talk to your coach'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
        <button className="btn primary" style={{ height: 46 }} onClick={() => send(text)} disabled={!text.trim() || streaming !== null || !state.hasKey}><Send size={16} /></button>
      </div>
    </div>
  )
}
