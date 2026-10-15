import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, ExternalLink, Mail, MessageSquareText, Pencil, Search, Trash2, UserPlus, UserSearch } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { Avatar, Empty, Modal, Spinner, fmtDate } from '../components/ui'
import { CONTACT_STATUSES, type Company, type Contact, type ContactStatus, type OrgPeopleMeta, type PeopleProgress } from '../../../shared/types'

const COST_PER_COMPANY = '$0.20–0.40'
const STATUS_TONE: Record<ContactStatus, string> = {
  'to-contact': '', contacted: 'blue', replied: 'violet', meeting: 'gold', referred: 'good', 'not-relevant': 'bad'
}
const linkedinSearch = (q: string): string => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`
const open = (url: string): void => { call('shell:openExternal', url).catch(() => undefined) }

export default function People() {
  const { state, patch, run, toast } = useDesk()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | ContactStatus>('all')
  const [indiaOnly, setIndiaOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<PeopleProgress | null>(state.peopleProgress)
  const [editing, setEditing] = useState<{ companyId: string; contact?: Contact } | null>(null)
  const [drafting, setDrafting] = useState<Contact | null>(null)

  useEffect(() => onEvent('people:progress', (p) => {
    const next = p as PeopleProgress
    setProgress(next)
    if (!next.running) call<typeof state>('state:get').then((s) => patch((st) => ({ ...st, contacts: s.contacts, orgPeople: s.orgPeople }))).catch(() => undefined)
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const byCompany = useMemo(() => {
    const m = new Map<string, Contact[]>()
    for (const c of state.contacts) m.set(c.companyId, [...(m.get(c.companyId) ?? []), c])
    return m
  }, [state.contacts])
  const orphans = state.contacts.filter((c) => !state.companies.some((co) => co.id === c.companyId))
  const unresearched = state.companies.filter((c) => !state.orgPeople[c.id])
  const totals = {
    people: state.contacts.length,
    contacted: state.contacts.filter((c) => c.status !== 'to-contact' && c.status !== 'not-relevant').length,
    warm: state.contacts.filter((c) => ['replied', 'meeting', 'referred'].includes(c.status)).length
  }

  const matches = (c: Contact): boolean => {
    const needle = q.trim().toLowerCase()
    return (status === 'all' || c.status === status) && (!indiaOnly || c.scope === 'india') &&
      (!needle || `${c.name} ${c.title} ${c.companyName} ${c.location ?? ''}`.toLowerCase().includes(needle))
  }
  const filtering = !!q.trim() || status !== 'all' || indiaOnly

  const replaceContacts = (companyId: string, contacts: Contact[], meta?: OrgPeopleMeta): void =>
    patch((s) => ({
      ...s,
      contacts: [...s.contacts.filter((c) => c.companyId !== companyId), ...contacts],
      orgPeople: meta ? { ...s.orgPeople, [companyId]: meta } : s.orgPeople
    }))
  const replaceOne = (c: Contact): void =>
    patch((s) => ({ ...s, contacts: s.contacts.some((x) => x.id === c.id) ? s.contacts.map((x) => (x.id === c.id ? c : x)) : [...s.contacts, c] }))

  const research = async (co: Company): Promise<void> => {
    setBusy(co.id)
    const r = await run(() => call<{ contacts: Contact[]; meta: OrgPeopleMeta; added: number }>('people:research', co.id))
    if (r) {
      replaceContacts(co.id, r.contacts, r.meta)
      toast(r.added ? `Found ${r.added} new ${r.added === 1 ? 'person' : 'people'} at ${co.name}.` : `No new people found at ${co.name}.`, r.added ? 'good' : 'info')
    }
    setBusy(null)
  }
  const researchMany = async (companies: Company[]): Promise<void> => {
    if (!companies.length) return
    if (!window.confirm(`Find people at ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}?\n\nThis uses live web search with your Anthropic key: about ${COST_PER_COMPANY} per company. It runs in the background — you can keep using the app.`)) return
    const p = await run(() => call<PeopleProgress>('people:researchMany', companies.map((c) => c.id)))
    if (p) setProgress(p)
  }
  const save = async (c: Contact): Promise<void> => {
    const saved = await run(() => call<Contact>('people:save', c))
    if (saved) replaceOne(saved)
  }
  const removeContact = async (c: Contact): Promise<void> => {
    if (!window.confirm(`Remove ${c.name}?`)) return
    await run(() => call('people:remove', c.id))
    patch((s) => ({ ...s, contacts: s.contacts.filter((x) => x.id !== c.id) }))
  }
  const usePattern = async (c: Contact): Promise<void> => {
    const saved = await run(() => call<Contact>('people:applyPattern', c.id))
    if (saved) replaceOne(saved)
  }

  const running = progress?.running
  const companies = [...state.companies].sort((a, b) => (byCompany.get(b.id)?.length ?? 0) - (byCompany.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name))

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">People</div>
          <div className="page-title">Who to reach at your dream companies</div>
          <div className="page-sub">
            India leaders and hiring managers first, then the international leaders who shape India hiring. Every name links to the page it was found on.
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => run(() => call('people:exportCsv'))} disabled={!state.contacts.length}><Download size={15} /> Export CSV</button>
          {unresearched.length > 0 && (
            <button className="btn primary" disabled={running || !state.hasKey} onClick={() => researchMany(unresearched)}>
              <UserSearch size={16} /> Find people at {unresearched.length} {unresearched.length === 1 ? 'company' : 'companies'}
            </button>
          )}
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card tight"><div className="stat-label">Companies</div><div className="stat-num" style={{ fontSize: 24 }}>{state.companies.length}</div><div className="tiny muted">{state.companies.length - unresearched.length} researched</div></div>
        <div className="card tight"><div className="stat-label">People mapped</div><div className="stat-num" style={{ fontSize: 24 }}>{totals.people}</div><div className="tiny muted">{state.contacts.filter((c) => c.scope === 'india').length} in India</div></div>
        <div className="card tight"><div className="stat-label">Reached out</div><div className="stat-num" style={{ fontSize: 24 }}>{totals.contacted}</div><div className="tiny muted">mark them as you go</div></div>
        <div className="card tight"><div className="stat-label">Warm conversations</div><div className="stat-num" style={{ fontSize: 24, color: totals.warm ? 'var(--good)' : undefined }}>{totals.warm}</div><div className="tiny muted">replied, meeting or referral</div></div>
      </div>

      {progress && (progress.running || progress.error) && (
        <div className="card tight" style={{ marginBottom: 16 }}>
          <div className="row between small">
            <span>{progress.running ? <>Researching {progress.current ?? '…'} — {progress.added ?? 0} people found so far</> : 'Research run finished'}</span>
            <span className="muted">{progress.done} / {progress.total}</span>
          </div>
          <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
          {progress.error && <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>{progress.error}</div>}
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ position: 'relative', minWidth: 240 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person, title or company" style={{ paddingLeft: 34 }} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ContactStatus)} style={{ width: 200 }}>
          <option value="all">Any status</option>
          {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={indiaOnly} onChange={(e) => setIndiaOnly(e.target.checked)} /> India-based only</label>
      </div>

      {!state.hasKey && <div className="card tight" style={{ marginBottom: 14, color: 'var(--warn)' }}>Add your Anthropic key in Settings to research people. You can still add people yourself.</div>}

      {state.companies.length ? (
        <div className="stack" style={{ gap: 14 }}>
          {companies.map((co) => {
            const people = (byCompany.get(co.id) ?? []).filter(matches)
            if (filtering && !people.length) return null
            return (
              <OrgCard key={co.id} name={co.name} meta={state.orgPeople[co.id]} people={people} total={byCompany.get(co.id)?.length ?? 0}
                busy={busy === co.id} canResearch={state.hasKey && !running && !busy}
                onResearch={() => research(co)} onAdd={() => setEditing({ companyId: co.id })}
                onSave={save} onEdit={(c) => setEditing({ companyId: co.id, contact: c })} onRemove={removeContact}
                onDraft={setDrafting} onPattern={usePattern} />
            )
          })}
          {orphans.filter(matches).length > 0 && (
            <OrgCard name="No longer on your watch list" people={orphans.filter(matches)} total={orphans.length} busy={false} canResearch={false}
              onSave={save} onEdit={(c) => setEditing({ companyId: c.companyId, contact: c })} onRemove={removeContact} onDraft={setDrafting} onPattern={usePattern} />
          )}
        </div>
      ) : <Empty title="No target companies yet">Add companies on the Jobs page, then find the people to reach at each.</Empty>}

      {editing && <EditContact companyId={editing.companyId} contact={editing.contact} onClose={() => setEditing(null)}
        onSaved={(c) => { replaceOne(c); setEditing(null) }} />}
      {drafting && <DraftModal contact={drafting} onClose={() => setDrafting(null)} onContacted={(c) => { save(c); setDrafting(null) }} />}
    </div>
  )
}

function OrgCard({ name, meta, people, total, busy, canResearch, onResearch, onAdd, onSave, onEdit, onRemove, onDraft, onPattern }: {
  name: string; meta?: OrgPeopleMeta; people: Contact[]; total: number; busy: boolean; canResearch: boolean
  onResearch?: () => void; onAdd?: () => void; onSave: (c: Contact) => void; onEdit: (c: Contact) => void
  onRemove: (c: Contact) => void; onDraft: (c: Contact) => void; onPattern: (c: Contact) => void
}) {
  // India first; otherwise keep research order, which runs leadership → hiring managers → recruiters.
  const sorted = [...people].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'india' ? -1 : 1))
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: sorted.length ? 12 : 0 }}>
        <Avatar name={name} size={34} />
        <div className="grow">
          <div className="row wrap" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15.5 }}>{name}</span>
            {total > 0 && <span className="pill">{total} {total === 1 ? 'person' : 'people'}</span>}
            {meta?.emailPattern && (
              <button className="pill blue" style={{ border: 'none', cursor: 'pointer' }} title="Open the page this format came from" onClick={() => open(meta.emailPattern!.sourceUrl)}>
                <Mail size={11} /> Email format: {meta.emailPattern.pattern}
              </button>
            )}
          </div>
          <div className="small muted" style={{ marginTop: 3 }}>
            {meta ? <>{meta.indiaPresence ?? 'Researched'} · researched {fmtDate(meta.researchedAt)}{meta.dropped ? ` · ${meta.dropped} unconfirmed name${meta.dropped === 1 ? '' : 's'} left out` : ''}</> : onResearch ? 'Not researched yet.' : ''}
          </div>
        </div>
        {onResearch && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => open(linkedinSearch(`${name} India sales`))} title="Search LinkedIn yourself"><Search size={13} /> LinkedIn</button>
            <button className="btn sm ghost" onClick={onAdd}><UserPlus size={13} /> Add</button>
            <button className="btn sm" onClick={onResearch} disabled={!canResearch}>{busy ? <Spinner size={13} /> : <UserSearch size={13} />} {meta ? 'Find more' : 'Find people'}</button>
          </div>
        )}
      </div>
      {busy && !sorted.length && <div className="small muted"><Spinner size={13} /> Searching the web for {name}’s India leaders, hiring managers and recruiters — usually under a minute…</div>}
      {sorted.length > 0 && (
        <table className="register people">
          <thead><tr><th>Person</th><th>Focus</th><th>Email</th><th>LinkedIn</th><th>Status</th><th /></tr></thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id}>
                <td style={{ minWidth: 220 }}>
                  <b>{c.name}</b>
                  {c.confidence === 'low' && <span className="pill" style={{ marginLeft: 6 }} title="Only a directory or data-broker page shows this — confirm on LinkedIn before reaching out">single source</span>}
                  <div className="small">{c.title}</div>
                  {c.location && <div className="tiny muted">{c.location}</div>}
                  {c.why && <div className="tiny muted" style={{ marginTop: 3, maxWidth: 420 }}>{c.why}</div>}
                </td>
                <td><span className={`pill ${c.scope === 'india' ? 'gold' : 'blue'}`}>{c.scope === 'india' ? 'India' : 'International'}</span></td>
                <td style={{ minWidth: 190 }}>
                  {c.email ? (
                    <div className="row" style={{ gap: 4 }}>
                      <span className="small" style={{ wordBreak: 'break-all' }}>{c.email}</span>
                      <button className="icon-btn" style={{ padding: 3 }} title="Copy" onClick={() => navigator.clipboard.writeText(c.email!)}><Copy size={12} /></button>
                    </div>
                  ) : <span className="muted small">—</span>}
                  {c.email && <div className="tiny" style={{ color: c.emailSource === 'pattern' ? 'var(--warn)' : 'var(--muted)' }}>
                    {c.emailSource === 'pattern' ? 'From company format — unverified' : c.emailSource === 'public' ? 'Published online' : 'Added by you'}</div>}
                  {!c.email && meta?.emailPattern && <button className="btn sm ghost" style={{ padding: '2px 0' }} onClick={() => onPattern(c)}>Use company format</button>}
                </td>
                <td>
                  {c.linkedin
                    ? <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => open(c.linkedin!)}><ExternalLink size={13} /> Profile</button>
                    : <button className="btn sm ghost muted" style={{ paddingLeft: 0 }} title="No profile link was confirmed — search LinkedIn" onClick={() => open(linkedinSearch(`${c.name} ${c.companyName}`))}><Search size={13} /> Search</button>}
                </td>
                <td style={{ minWidth: 140 }}>
                  <select className={`status-select ${STATUS_TONE[c.status]}`} value={c.status} onChange={(e) => onSave({ ...c, status: e.target.value as ContactStatus })}>
                    {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  {c.lastContactedAt && <div className="tiny muted" style={{ marginTop: 3 }}>contacted {fmtDate(c.lastContactedAt)}</div>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="icon-btn" title="Draft a message" onClick={() => onDraft(c)}><MessageSquareText size={15} /></button>
                  {c.sourceUrl && <button className="icon-btn" title="Where this was found" onClick={() => open(c.sourceUrl!)}><ExternalLink size={14} /></button>}
                  <button className="icon-btn" title="Edit" onClick={() => onEdit(c)}><Pencil size={14} /></button>
                  <button className="icon-btn" title="Remove" onClick={() => onRemove(c)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function EditContact({ companyId, contact, onClose, onSaved }: { companyId: string; contact?: Contact; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { run } = useDesk()
  const [d, setD] = useState<Partial<Contact>>(contact ?? { scope: 'india' })
  const set = (p: Partial<Contact>): void => setD((x) => ({ ...x, ...p }))
  const submit = async (): Promise<void> => {
    const saved = contact
      ? await run(() => call<Contact>('people:save', { ...contact, ...d }))
      : await run(() => call<Contact>('people:add', companyId, d))
    if (saved) onSaved(saved)
  }
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 14 }}>{contact ? `Edit ${contact.name}` : 'Add a person'}</h2>
      <div className="stack" style={{ gap: 12 }}>
        <div className="grid g2">
          <label className="field">Name<input autoFocus value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Title<input value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field">Location<input value={d.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></label>
          <label className="field">Focus
            <select value={d.scope ?? 'india'} onChange={(e) => set({ scope: e.target.value as Contact['scope'] })}>
              <option value="india">India</option><option value="global">International</option>
            </select>
          </label>
        </div>
        <label className="field">Email<input value={d.email ?? ''} onChange={(e) => set({ email: e.target.value, emailSource: e.target.value ? 'manual' : undefined })} placeholder="Work email, if you have it" /></label>
        <label className="field">LinkedIn profile<input value={d.linkedin ?? ''} onChange={(e) => set({ linkedin: e.target.value })} placeholder="https://www.linkedin.com/in/…" /></label>
        <label className="field">Notes<textarea rows={3} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="How you know them, what you said, when to follow up" /></label>
      </div>
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!d.name?.trim()} onClick={submit}>Save</button>
      </div>
    </Modal>
  )
}

function DraftModal({ contact, onClose, onContacted }: { contact: Contact; onClose: () => void; onContacted: (c: Contact) => void }) {
  const { state, run, toast } = useDesk()
  const [kind, setKind] = useState<'linkedin' | 'email'>(contact.email ? 'email' : 'linkedin')
  const [draft, setDraft] = useState<{ subject: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const make = async (k: 'linkedin' | 'email'): Promise<void> => {
    setKind(k); setBusy(true); setDraft(null)
    const r = await run(() => call<{ subject: string; message: string }>('people:draft', contact.id, k))
    if (r) setDraft(r)
    setBusy(false)
  }
  const copy = (): void => {
    if (!draft) return
    navigator.clipboard.writeText(kind === 'email' && draft.subject ? `Subject: ${draft.subject}\n\n${draft.message}` : draft.message)
    toast('Copied — paste it into LinkedIn or your email.', 'good')
  }
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 4 }}>Message to {contact.name}</h2>
      <div className="small muted" style={{ marginBottom: 14 }}>{contact.title}, {contact.companyName}</div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${kind === 'linkedin' ? 'on' : ''}`} onClick={() => make('linkedin')} disabled={busy}>LinkedIn note</button>
        <button className={`tab ${kind === 'email' ? 'on' : ''}`} onClick={() => make('email')} disabled={busy}>Email</button>
      </div>
      {busy ? <div className="muted small"><Spinner size={14} /> Your coach is writing it from your CV…</div>
        : draft ? (
          <div className="stack" style={{ gap: 8 }}>
            {kind === 'email' && draft.subject && <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />}
            <textarea rows={kind === 'email' ? 10 : 5} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
            {kind === 'linkedin' && <div className="tiny" style={{ color: draft.message.length > 300 ? 'var(--bad)' : 'var(--muted)' }}>{draft.message.length} / 300 characters</div>}
          </div>
        ) : (
          <div className="small muted">{state.hasKey ? 'Pick LinkedIn note or Email and your coach will draft it from your CV.' : 'Add your Anthropic key in Settings for drafts.'}</div>
        )}
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <div className="row">
          <button className="btn" disabled={!draft} onClick={copy}><Copy size={14} /> Copy</button>
          {contact.status === 'to-contact' && <button className="btn primary" onClick={() => onContacted({ ...contact, status: 'contacted' })}>Mark as contacted</button>}
        </div>
      </div>
    </Modal>
  )
}
