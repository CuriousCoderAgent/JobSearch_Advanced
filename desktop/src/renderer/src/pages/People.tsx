import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, ExternalLink, FileSpreadsheet, Mail, MessageSquareText, Pencil, Search, Trash2, UserPlus, UserSearch } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { Avatar, Empty, Modal, Spinner, fmtDate } from '../components/ui'
import {
  CONNECTION_STATUSES, CONTACT_STATUSES, localDay,
  type Company, type ConnectionStatus, type Contact, type ContactImportResult, type ContactStatus, type OrgPeopleMeta, type PeopleProgress
} from '../../../shared/types'

const COST_PER_COMPANY = '$0.20–0.40'
const STATUS_TONE: Record<ContactStatus, string> = {
  'to-contact': '', 'intro-requested': 'blue', contacted: 'blue', replied: 'violet', meeting: 'gold', referred: 'good',
  applied: 'good', 'in-process': 'gold', closed: 'bad', 'not-relevant': 'bad'
}
const CONNECTION_TONE: Record<ConnectionStatus, string> = { 'not-connected': '', requested: 'blue', connected: 'good' }
const AWAITING: ContactStatus[] = ['contacted', 'intro-requested']
const linkedinSearch = (q: string): string => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`
const open = (url: string): void => { call('shell:openExternal', url).catch(() => undefined) }

type Editing = { mode: 'edit'; contact: Contact } | { mode: 'add'; companyId?: string }

export default function People() {
  const { state, patch, run, toast } = useDesk()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | ContactStatus>('all')
  const [connection, setConnection] = useState<'all' | ConnectionStatus>('all')
  const [priority, setPriority] = useState<'all' | '1' | '2' | '3'>('all')
  const [indiaOnly, setIndiaOnly] = useState(false)
  const [dueOnly, setDueOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<PeopleProgress | null>(state.peopleProgress)
  const [editing, setEditing] = useState<Editing | null>(null)
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
  const empty = state.companies.filter((c) => !byCompany.get(c.id)?.length)
  const today = localDay()
  const totals = {
    people: state.contacts.length,
    connected: state.contacts.filter((c) => c.connection === 'connected').length,
    contacted: state.contacts.filter((c) => !['to-contact', 'not-relevant'].includes(c.status)).length,
    warm: state.contacts.filter((c) => ['replied', 'meeting', 'referred', 'applied', 'in-process'].includes(c.status)).length,
    due: state.contacts.filter((c) => AWAITING.includes(c.status) && c.followUpDate && c.followUpDate <= today).length
  }

  const matches = (c: Contact): boolean => {
    const needle = q.trim().toLowerCase()
    return (status === 'all' || c.status === status) &&
      (connection === 'all' || (c.connection ?? 'not-connected') === connection) &&
      (priority === 'all' || String(c.priority ?? '') === priority) && (!indiaOnly || c.scope === 'india') &&
      (!dueOnly || (AWAITING.includes(c.status) && !!c.followUpDate && c.followUpDate <= today)) &&
      (!needle || `${c.name} ${c.title} ${c.companyName} ${c.location ?? ''} ${c.contactType ?? ''}`.toLowerCase().includes(needle))
  }
  const filtering = !!q.trim() || status !== 'all' || connection !== 'all' || priority !== 'all' || indiaOnly || dueOnly

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
      replaceContacts(co.id, r.contacts, { ...state.orgPeople[co.id], ...r.meta })
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
  const importMap = async (): Promise<void> => {
    const r = await run(() => call<{ result: ContactImportResult; contacts: Contact[]; orgPeople: Record<string, OrgPeopleMeta>; companies: Company[] } | null>('people:import'))
    if (!r) return
    patch((s) => ({ ...s, contacts: r.contacts, orgPeople: r.orgPeople, companies: r.companies }))
    const { added, updated, companiesAdded, skipped } = r.result
    toast(`Imported ${r.result.file}: ${added} new, ${updated} updated${companiesAdded.length ? `; added ${companiesAdded.join(', ')} to your watch list` : ''}${skipped ? `; ${skipped} rows skipped (no company or name)` : ''}.`, 'good')
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
  const handlers = { onSave: save, onEdit: (c: Contact) => setEditing({ mode: 'edit', contact: c }), onRemove: removeContact, onDraft: setDrafting, onPattern: usePattern }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">People</div>
          <div className="page-title">Who to reach at your dream companies</div>
          <div className="page-sub">India leaders and hiring managers first, then the international leaders who shape India hiring. Track who you’re connected with and where each conversation stands.</div>
        </div>
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={importMap} title="Import a contact map from Excel (.xlsx) or CSV — re-importing updates people already here"><FileSpreadsheet size={15} /> Import from Excel</button>
          <button className="btn" onClick={() => run(() => call('people:exportCsv'))} disabled={!state.contacts.length}><Download size={15} /> Export</button>
          <button className="btn primary" onClick={() => setEditing({ mode: 'add' })}><UserPlus size={16} /> Add person</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat label="People mapped" value={totals.people} note={`${state.contacts.filter((c) => c.scope === 'india').length} India · across ${state.companies.length - empty.length} companies`} />
        <Stat label="Connected on LinkedIn" value={totals.connected} note={`${state.contacts.filter((c) => c.connection === 'requested').length} requests pending`} />
        <Stat label="Reached out" value={totals.contacted} note="intro, message or email" />
        <Stat label="Warm" value={totals.warm} note="replied, call, referral, applied" tone={totals.warm ? 'var(--good)' : undefined} />
        <Stat label="Follow-ups due" value={totals.due} note="a week after you reach out" tone={totals.due ? 'var(--warn)' : undefined}
          active={dueOnly} onClick={totals.due || dueOnly ? () => setDueOnly(!dueOnly) : undefined} />
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person, designation, company or contact type" style={{ paddingLeft: 34 }} />
        </div>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={{ width: 150 }}>
          <option value="all">Any priority</option><option value="1">Priority 1</option><option value="2">Priority 2</option><option value="3">Priority 3</option>
        </select>
        <select value={connection} onChange={(e) => setConnection(e.target.value as typeof connection)} style={{ width: 170 }}>
          <option value="all">Connected or not</option>
          {CONNECTION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ContactStatus)} style={{ width: 170 }}>
          <option value="all">Any outreach status</option>
          {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={indiaOnly} onChange={(e) => setIndiaOnly(e.target.checked)} /> India-based only</label>
        {dueOnly && <button className="pill gold" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setDueOnly(false)}>Follow-ups due ✕</button>}
      </div>

      {empty.length > 0 && !filtering && (
        <div className="card tight row between" style={{ marginBottom: 14 }}>
          <span className="small">{empty.length} {empty.length === 1 ? 'company has' : 'companies have'} no one mapped yet: {empty.slice(0, 6).map((c) => c.name).join(', ')}{empty.length > 6 ? '…' : ''}</span>
          <button className="btn sm" disabled={running || !state.hasKey} onClick={() => researchMany(empty)}><UserSearch size={13} /> Find people ({COST_PER_COMPANY} each)</button>
        </div>
      )}

      {state.companies.length ? (
        <div className="stack" style={{ gap: 14 }}>
          {companies.map((co) => {
            const people = (byCompany.get(co.id) ?? []).filter(matches)
            if (filtering && !people.length) return null
            if (!filtering && !people.length && !state.orgPeople[co.id]) return null // listed in the "no one mapped" strip above
            return (
              <OrgCard key={co.id} name={co.name} meta={state.orgPeople[co.id]} people={people} total={byCompany.get(co.id)?.length ?? 0}
                busy={busy === co.id} canResearch={state.hasKey && !running && !busy}
                onResearch={() => research(co)} onAdd={() => setEditing({ mode: 'add', companyId: co.id })} {...handlers} />
            )
          })}
          {orphans.filter(matches).length > 0 && (
            <OrgCard name="No longer on your watch list" people={orphans.filter(matches)} total={orphans.length} busy={false} canResearch={false} {...handlers} />
          )}
        </div>
      ) : <Empty title="No target companies yet" action={<button className="btn primary" onClick={importMap}><FileSpreadsheet size={16} /> Import a contact map</button>}>
          Import your contact map from Excel, or add companies on the Jobs page.</Empty>}

      {editing && <EditContact editing={editing} companies={state.companies} onClose={() => setEditing(null)}
        onSaved={(c, company) => {
          replaceOne(c)
          if (company) patch((s) => ({ ...s, companies: [...s.companies, company] }))
          setEditing(null)
        }} />}
      {drafting && <DraftModal contact={drafting} onClose={() => setDrafting(null)} onContacted={(c) => { save(c); setDrafting(null) }} />}
    </div>
  )
}

function Stat({ label, value, note, tone, active, onClick }: { label: string; value: number; note: string; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <div className={`card tight${onClick ? ' clickable' : ''}`} onClick={onClick} style={active ? { borderColor: 'var(--warn)' } : undefined} title={onClick ? (active ? 'Show everyone' : 'Show only these') : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-num" style={{ fontSize: 24, color: tone }}>{value}</div>
      <div className="tiny muted">{note}</div>
    </div>
  )
}

interface RowHandlers {
  onSave: (c: Contact) => void; onEdit: (c: Contact) => void; onRemove: (c: Contact) => void
  onDraft: (c: Contact) => void; onPattern: (c: Contact) => void
}

function OrgCard({ name, meta, people, total, busy, canResearch, onResearch, onAdd, onSave, onEdit, onRemove, onDraft, onPattern }: {
  name: string; meta?: OrgPeopleMeta; people: Contact[]; total: number; busy: boolean; canResearch: boolean
  onResearch?: () => void; onAdd?: () => void
} & RowHandlers) {
  const today = localDay()
  // Priority first, then India before international; otherwise keep the map's order.
  const sorted = [...people].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.scope === b.scope ? 0 : a.scope === 'india' ? -1 : 1))
  const connected = people.filter((c) => c.connection === 'connected').length
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: sorted.length ? 12 : 0 }}>
        <Avatar name={name} size={34} />
        <div className="grow">
          <div className="row wrap" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15.5 }}>{name}</span>
            {total > 0 && <span className="pill">{total} {total === 1 ? 'person' : 'people'}{connected ? ` · ${connected} connected` : ''}</span>}
            {meta?.category && <span className="pill">{meta.category}</span>}
            {meta?.fit && <span className={`pill ${/high/i.test(meta.fit) ? 'good' : 'gold'}`}>{meta.fit}</span>}
            {meta?.emailPattern && (
              <button className="pill blue" style={{ border: 'none', cursor: 'pointer' }} title="Open the page this format came from" onClick={() => open(meta.emailPattern!.sourceUrl)}>
                <Mail size={11} /> Email format: {meta.emailPattern.pattern}
              </button>
            )}
          </div>
          {meta?.approach && <div className="small" style={{ marginTop: 4 }}><b style={{ color: 'var(--gold-2)' }}>Route in: </b>{meta.approach}{meta.firstContact ? <span className="muted"> · start with {meta.firstContact}</span> : null}</div>}
          {meta?.indiaPresence && <div className="small muted" style={{ marginTop: 3 }}>{meta.indiaPresence}</div>}
          {!meta && onResearch && <div className="small muted" style={{ marginTop: 3 }}>No one mapped yet.</div>}
        </div>
        {onResearch && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => open(linkedinSearch(`${name} India sales`))} title="Search LinkedIn yourself"><Search size={13} /> LinkedIn</button>
            <button className="btn sm ghost" onClick={onAdd}><UserPlus size={13} /> Add</button>
            <button className="btn sm ghost" onClick={onResearch} disabled={!canResearch} title={`Web search for more people — about ${COST_PER_COMPANY}`}>{busy ? <Spinner size={13} /> : <UserSearch size={13} />} Find more</button>
          </div>
        )}
      </div>
      {busy && <div className="small muted" style={{ marginBottom: 8 }}><Spinner size={13} /> Searching the web for more of {name}’s India leaders, hiring managers and recruiters — usually under a minute…</div>}
      {sorted.length > 0 && (
        <table className="register people">
          <thead><tr><th>Person & designation</th><th>Focus</th><th>Email</th><th>LinkedIn</th><th>Connected?</th><th>Outreach</th><th /></tr></thead>
          <tbody>
            {sorted.map((c) => {
              const due = AWAITING.includes(c.status) && !!c.followUpDate && c.followUpDate <= today
              return (
                <tr key={c.id}>
                  <td style={{ minWidth: 240 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {c.priority && <span className={`pill ${c.priority === 1 ? 'gold' : ''}`} title={c.priority === 1 ? 'Approach first' : c.priority === 2 ? 'Supporting route' : 'Secondary / exploratory'}>P{c.priority}</span>}
                      <b>{c.name}</b>
                      {c.confidence === 'low' && <span className="pill" title="Only a directory or data-broker page shows this — confirm on LinkedIn before reaching out">single source</span>}
                    </div>
                    <div className="small" style={{ marginTop: 2 }}>{c.title || <span className="muted">No designation yet</span>}</div>
                    <div className="tiny muted">{[c.contactType, c.location].filter(Boolean).join(' · ')}</div>
                    {c.why && <div className="tiny muted" style={{ marginTop: 3, maxWidth: 440 }}>{c.why}</div>}
                    {c.roleCheck && /needs confirmation|confirm exact/i.test(c.roleCheck) && <div className="tiny" style={{ color: 'var(--warn)', marginTop: 2 }} title={c.roleCheck}>⚠ Confirm the exact title on LinkedIn</div>}
                  </td>
                  <td><span className={`pill ${c.scope === 'india' ? 'gold' : 'blue'}`}>{c.scope === 'india' ? 'India' : 'International'}</span></td>
                  <td style={{ minWidth: 180 }}>
                    {c.email ? (
                      <div className="row" style={{ gap: 4 }}>
                        <span className="small" style={{ wordBreak: 'break-all' }}>{c.email}</span>
                        <button className="icon-btn" style={{ padding: 3 }} title="Copy" onClick={() => navigator.clipboard.writeText(c.email!)}><Copy size={12} /></button>
                      </div>
                    ) : <span className="muted small">—</span>}
                    {c.email && <div className="tiny" style={{ color: c.emailSource === 'pattern' || /not independently|third-party/i.test(c.emailNote ?? '') ? 'var(--warn)' : 'var(--muted)' }}>
                      {c.emailNote ?? (c.emailSource === 'pattern' ? 'From company format — unverified' : c.emailSource === 'public' ? 'Published online' : 'Added by you')}
                      {c.emailSourceUrl && <> · <a href="#" onClick={(e) => { e.preventDefault(); open(c.emailSourceUrl!) }}>source</a></>}</div>}
                    {!c.email && meta?.emailPattern && <button className="btn sm ghost" style={{ padding: '2px 0' }} onClick={() => onPattern(c)}>Use company format</button>}
                  </td>
                  <td>
                    {c.linkedin
                      ? <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => open(c.linkedin!)}><ExternalLink size={13} /> Profile</button>
                      : <button className="btn sm ghost muted" style={{ paddingLeft: 0 }} title="No profile link yet — search LinkedIn" onClick={() => open(linkedinSearch(`${c.name} ${c.companyName}`))}><Search size={13} /> Search</button>}
                  </td>
                  <td style={{ minWidth: 158 }}>
                    <select className={`status-select ${CONNECTION_TONE[c.connection ?? 'not-connected']}`} value={c.connection ?? 'not-connected'}
                      onChange={(e) => onSave({ ...c, connection: e.target.value as ConnectionStatus })}>
                      {CONNECTION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <select className={`status-select ${STATUS_TONE[c.status]}`} value={c.status} onChange={(e) => onSave({ ...c, status: e.target.value as ContactStatus })}>
                      {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    {AWAITING.includes(c.status) && c.followUpDate
                      ? <div className="tiny" style={{ marginTop: 3, color: due ? 'var(--warn)' : 'var(--muted)', fontWeight: due ? 650 : undefined }}>{due ? 'Follow up now' : `Follow up ${fmtDate(c.followUpDate)}`}</div>
                      : c.lastContactedAt ? <div className="tiny muted" style={{ marginTop: 3 }}>last contact {fmtDate(c.lastContactedAt)}</div> : null}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="icon-btn" title="Draft a message" onClick={() => onDraft(c)}><MessageSquareText size={15} /></button>
                    {c.sourceUrl && c.sourceUrl !== c.linkedin && <button className="icon-btn" title="Where this was found" onClick={() => open(c.sourceUrl!)}><ExternalLink size={14} /></button>}
                    <button className="icon-btn" title="Edit" onClick={() => onEdit(c)}><Pencil size={14} /></button>
                    <button className="icon-btn" title="Remove" onClick={() => onRemove(c)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const NEW_ORG = '__new__'

function EditContact({ editing, companies, onClose, onSaved }: {
  editing: Editing; companies: Company[]; onClose: () => void; onSaved: (c: Contact, newCompany: Company | null) => void
}) {
  const { run } = useDesk()
  const contact = editing.mode === 'edit' ? editing.contact : undefined
  const [d, setD] = useState<Partial<Contact>>(contact ?? { scope: 'india', connection: 'not-connected', status: 'to-contact' })
  const [companyId, setCompanyId] = useState(editing.mode === 'add' ? editing.companyId ?? '' : contact!.companyId)
  const [newOrg, setNewOrg] = useState('')
  const set = (p: Partial<Contact>): void => setD((x) => ({ ...x, ...p }))
  const sortedCompanies = [...companies].sort((a, b) => a.name.localeCompare(b.name))
  const canSave = !!d.name?.trim() && (contact || (companyId && (companyId !== NEW_ORG || newOrg.trim())))
  const submit = async (): Promise<void> => {
    if (contact) {
      const saved = await run(() => call<Contact>('people:save', { ...contact, ...d }))
      if (saved) onSaved(saved, null)
      return
    }
    const ref = companyId === NEW_ORG ? { name: newOrg.trim() } : { id: companyId }
    const r = await run(() => call<{ contact: Contact; company: Company | null }>('people:add', ref, d))
    if (r) onSaved(r.contact, r.company)
  }
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 14 }}>{contact ? `Edit ${contact.name}` : 'Add a person'}</h2>
      <div className="stack" style={{ gap: 12 }}>
        {contact ? <div className="small muted">{contact.companyName}</div> : (
          <div className="grid g2">
            <label className="field">Organisation
              <select autoFocus value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Choose…</option>
                {sortedCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW_ORG}>+ A new organisation…</option>
              </select>
            </label>
            {companyId === NEW_ORG && <label className="field">New organisation<input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="e.g. Mistral AI — also added to your job radar" /></label>}
          </div>
        )}
        <div className="grid g2">
          <label className="field">Name<input autoFocus={!!contact} value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Designation<input value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Head of Enterprise Sales, India" /></label>
        </div>
        <label className="field">LinkedIn link<input value={d.linkedin ?? ''} onChange={(e) => set({ linkedin: e.target.value })} placeholder="https://www.linkedin.com/in/…" /></label>
        <div className="grid g3">
          <label className="field">Connected?
            <select value={d.connection ?? 'not-connected'} onChange={(e) => set({ connection: e.target.value as ConnectionStatus })}>
              {CONNECTION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">Outreach
            <select value={d.status ?? 'to-contact'} onChange={(e) => set({ status: e.target.value as ContactStatus })}>
              {CONTACT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <select value={d.priority ?? ''} onChange={(e) => set({ priority: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined })}>
              <option value="">—</option><option value="1">1 · approach first</option><option value="2">2 · supporting route</option><option value="3">3 · exploratory</option>
            </select>
          </label>
        </div>
        <div className="grid g3">
          <label className="field">Focus
            <select value={d.scope ?? 'india'} onChange={(e) => set({ scope: e.target.value as Contact['scope'] })}>
              <option value="india">India</option><option value="global">International</option>
            </select>
          </label>
          <label className="field">Contact type<input value={d.contactType ?? ''} onChange={(e) => set({ contactType: e.target.value })} placeholder="Hiring leader, Recruiter…" /></label>
          <label className="field">Location<input value={d.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></label>
        </div>
        <div className="grid g2">
          <label className="field">Email<input value={d.email ?? ''} onChange={(e) => set({ email: e.target.value, emailSource: e.target.value ? 'manual' : undefined, emailNote: undefined })} placeholder="Work email, if you have it" /></label>
          <label className="field">Follow up on<input type="date" value={d.followUpDate ?? ''} onChange={(e) => set({ followUpDate: e.target.value || undefined })} /></label>
        </div>
        <label className="field">Notes<textarea rows={3} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="How you know them, what you said, what's next" /></label>
      </div>
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!canSave} onClick={submit}>{contact ? 'Save' : 'Add person'}</button>
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
