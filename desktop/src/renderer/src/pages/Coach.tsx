import { useEffect, useRef, useState } from 'react'
import { Brain, Eraser, Plus, Send, X } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { Markdown, Spinner, fmtDate } from '../components/ui'
import type { ChatMessage, CoachMemory } from '../../../shared/types'

const STARTERS = [
  'Look at my pipeline — where am I most likely to get an offer, and what should I do this week?',
  'Grill me: ask me one tough question an AI-company panel would ask a senior enterprise seller, then critique my answer.',
  'How do I credibly pitch myself as an AI seller when most of my experience is traditional SaaS?',
  'Help me decide between the IC Account Director path and a leadership role for my next move.',
  'What should my compensation ask be for a senior enterprise role at an AI company in India?',
  'Which of my interview answers are weakest right now, and why?'
]

export default function Coach() {
  const { state, patch, run, focus } = useDesk()
  // Other pages open the coach with a message ready to send (a rough day, a rejection).
  const [text, setText] = useState(focus ?? '')
  const [streaming, setStreaming] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chat = state.chat

  useEffect(() => { if (focus) { setText(focus); inputRef.current?.focus() } }, [focus])
  useEffect(() => onEvent('coach:delta', (d) => setStreaming((s) => (s ?? '') + String(d))), [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.length, streaming])

  const send = async (msg: string): Promise<void> => {
    const content = msg.trim()
    if (!content || streaming !== null) return
    setText('')
    patch((s) => ({ ...s, chat: [...s.chat, { role: 'user', content, at: new Date().toISOString() }] }))
    setStreaming('')
    const next = await run(() => call<{ chat: ChatMessage[]; memory: CoachMemory[] }>('coach:chat', content))
    if (next) patch((s) => ({ ...s, chat: next.chat, memory: next.memory }))
    setStreaming(null)
  }
  const clear = async (): Promise<void> => {
    if (!window.confirm('Clear this conversation? Your coach keeps its notes about you.')) return
    await run(() => call('coach:clear'))
    patch((s) => ({ ...s, chat: [] }))
  }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 20, height: '100%', paddingBottom: 20, maxWidth: 1320 }}>
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: 0 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Coach</div>
            <div className="page-title">Your coach, fully briefed</div>
            <div className="page-sub">Knows your pipeline, your answers, your practice scores, how you’ve been feeling — and remembers what matters.</div>
          </div>
          {chat.length > 0 && <button className="btn ghost sm" onClick={clear}><Eraser size={14} /> Clear</button>}
        </div>

        <div style={{ overflow: 'auto', paddingRight: 6, minHeight: 0 }}>
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
          <textarea ref={inputRef} rows={text.length > 120 ? 4 : 2} value={text} onChange={(e) => setText(e.target.value)} disabled={!state.hasKey}
            placeholder={state.hasKey ? 'Ask your coach… (Enter to send, Shift+Enter for a new line)' : 'Add your Anthropic key in Settings to talk to your coach'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
          <button className="btn primary" style={{ height: 46 }} onClick={() => send(text)} disabled={!text.trim() || streaming !== null || !state.hasKey}><Send size={16} /></button>
        </div>
      </div>

      <MemoryPanel />
    </div>
  )
}

function MemoryPanel() {
  const { state, patch, run } = useDesk()
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const add = async (): Promise<void> => {
    const memory = await run(() => call<CoachMemory[]>('memory:add', note))
    if (memory) { patch((s) => ({ ...s, memory })); setNote(''); setAdding(false) }
  }
  const forget = async (id: string): Promise<void> => {
    const memory = await run(() => call<CoachMemory[]>('memory:remove', id))
    if (memory) patch((s) => ({ ...s, memory }))
  }
  return (
    <aside className="card" style={{ alignSelf: 'start', marginTop: 8, maxHeight: 'calc(100vh - 60px)', overflow: 'auto' }}>
      <div className="card-title"><Brain size={16} color="var(--violet)" /> What your coach remembers</div>
      <div className="tiny muted" style={{ marginBottom: 10 }}>Notes it keeps from your chats — goals, upcoming interviews, what trips you up. Every coaching session sees these.</div>
      <div className="stack" style={{ gap: 6 }}>
        {state.memory.length ? [...state.memory].reverse().map((m) => (
          <div key={m.id} className="memory-note">
            <span className="grow">{m.text}<span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>{fmtDate(m.at)}</span></span>
            <button className="icon-btn" style={{ padding: 2 }} title="Forget this" onClick={() => forget(m.id)}><X size={13} /></button>
          </div>
        )) : <div className="small muted">Nothing yet. Tell your coach about your goals and it will start keeping notes.</div>}
      </div>
      {adding ? (
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          <textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sarvam final round is on 14 Oct; I freeze on compensation questions" />
          <div className="row"><button className="btn sm primary" disabled={!note.trim()} onClick={add}>Save note</button><button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      ) : <button className="btn sm ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setAdding(true)}><Plus size={14} /> Tell your coach something</button>}
    </aside>
  )
}
