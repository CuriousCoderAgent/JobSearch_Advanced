import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, ExternalLink, EyeOff, FileText, MessageCircle, Plus, Users } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Avatar, Empty, Modal, Spinner, fmtDate } from '../components/ui'
import { fmtDays, missedSummary } from '../../../shared/missed'
import type { Job, JobCacheEntry } from '../../../shared/types'

// Matching roles the radar showed him that came down before he applied —
// what they were, how long he had, and what the pattern is costing him.

function Stat({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: string }) {
  return (
    <div className="card tight">
      <div className="stat-label">{label}</div>
      <div className="stat-num" style={{ fontSize: 24, color: tone }}>{value}</div>
      <div className="tiny muted">{note}</div>
    </div>
  )
}

const days = (d: number): string => `${Math.max(1, Math.round(d))}d`

// When the company posted it, if the feed says and it's earlier than the radar saw it.
function postedOn(j: Job): string | null {
  const t = j.postedAt ? Date.parse(j.postedAt) : NaN
  return Number.isFinite(t) && t <= Date.parse(j.firstSeen) ? new Date(t).toISOString() : null
}

export default function MissedRoles({ trackedIds, onTrack, onDismiss }: {
  trackedIds: Set<string>; onTrack: (id: string) => void; onDismiss: (id: string) => void
}) {
  const { state, go } = useDesk()
  const m = useMemo(() => missedSummary(state.jobs, state.applications), [state.jobs, state.applications])
  const [filter, setFilter] = useState<'all' | '30' | 'saved'>('all')
  const [reading, setReading] = useState<Job | null>(null)
  const hasCopy = (j: Job): boolean => !!j.cachedAt || state.applications.some((a) => a.jobId === j.id && !!a.jd?.trim())
  const peopleAt = (company: string): number => state.contacts.filter((c) => c.companyName.toLowerCase() === company.toLowerCase()).length

  const catchRate = m.closedTotal ? Math.round((m.caught / m.closedTotal) * 100) : null
  const withPeople = m.missed.filter((x) => peopleAt(x.job.company) > 0).length
  const shown = m.missed.filter((x) => filter === 'all' || (filter === 'saved' ? !!x.saved : Date.now() - new Date(x.job.goneAt!).getTime() <= 30 * 864e5))

  // Plain-language read of the pattern, built only from his own numbers.
  const insights: string[] = []
  if (m.medianOpenDays != null && m.medianApplyDays != null) {
    const target = Math.max(2, Math.round(m.medianOpenDays * 0.25))
    insights.push(m.medianApplyDays > m.medianOpenDays * 0.5
      ? `From the radar spotting a matching role to it coming down, you’ve typically had about ${fmtDays(m.medianOpenDays)} — and you usually apply ${fmtDays(m.medianApplyDays)} in, late in the window, when shortlists are often already forming. Aim for within ${target} days.`
      : `You usually apply within ${fmtDays(m.medianApplyDays)} of a role appearing — well inside the ~${fmtDays(m.medianOpenDays)} you typically get. The misses are roles you never got to, not slow ones: a fixed weekly slot to clear the radar would catch them.`)
  } else if (m.medianOpenDays != null) {
    insights.push(`From the radar spotting a matching role to it coming down, you’ve typically had about ${fmtDays(m.medianOpenDays)}. Track roles and mark them applied, and this will compare your own speed against that window.`)
  }
  if (m.missed.length && m.responseRate) {
    const worth = m.missed.length * m.responseRate.rate
    insights.push(`${Math.round(m.responseRate.rate * 100)}% of your ${m.responseRate.of} applications got a reply or an interview. At that rate, these ${m.missed.length} missed roles were worth about ${worth < 1 ? worth.toFixed(1) : Math.round(worth)} hiring conversation${Math.round(worth) === 1 ? '' : 's'}.`)
  } else if (m.missed.length) {
    insights.push('After 3 or more applications, this will also estimate how many interviews the missed roles were worth, using your own reply rate.')
  }
  if (withPeople) insights.push(`${withPeople} of them were at companies where you’d already mapped people. Asking one of them for a referral the day the role appears is the fastest way in.`)

  return (
    <>
      <div className="grid g4" style={{ gap: 12, marginBottom: 16 }}>
        <Stat label="Missed roles" value={m.missed.length} note={`${m.last30} in the last 30 days`} tone={m.missed.length ? 'var(--bad)' : undefined} />
        <Stat label="Caught in time" value={catchRate == null ? '—' : `${catchRate}%`}
          note={m.closedTotal ? `applied to ${m.caught} of ${m.closedTotal} matches that closed` : 'no matching role has closed yet'}
          tone={catchRate == null ? undefined : catchRate >= 50 ? 'var(--good)' : 'var(--warn)'} />
        <Stat label="Time you had" value={m.medianOpenDays == null ? '—' : `${days(m.medianOpenDays)}+`}
          note={m.medianApplyDays == null ? 'median, radar spotting a role → its last day live' : `median; you apply after ${days(m.medianApplyDays)}`} />
        <Stat label="Saved, never sent" value={m.savedNotApplied} note="tracked, but the application never went" tone={m.savedNotApplied ? 'var(--warn)' : undefined} />
      </div>

      {insights.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title"><Clock size={16} color="var(--gold)" /> The cost of waiting <span className="sub">this is a pattern to spot, not something to beat yourself up over</span></div>
          <div className="stack" style={{ gap: 8 }}>{insights.map((t, i) => <div key={i} className="small">{t}</div>)}</div>
          {m.byCompany.length > 0 && (
            <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
              <span className="tiny muted">Missed most at</span>
              {m.byCompany.slice(0, 8).map((c) => <span key={c.company} className="pill">{c.company}{c.count > 1 ? ` ×${c.count}` : ''}</span>)}
            </div>
          )}
        </div>
      )}

      {m.atRisk.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(245, 181, 68, 0.45)' }}>
          <div className="card-title"><Clock size={16} color="var(--warn)" /> Still open — don’t lose these too <span className="sub">matches you haven’t acted on, oldest first</span></div>
          <div className="list">
            {m.atRisk.slice(0, 6).map(({ job: j, openDays }) => (
              <div key={j.id} className="item">
                <Avatar name={j.company} size={32} />
                <div className="grow">
                  <div style={{ fontWeight: 650 }} className="ellipsis">{j.title}</div>
                  <div className="small muted ellipsis">{j.company}{j.location ? ` · ${j.location}` : ''}</div>
                </div>
                <span className="pill gold">on radar {days(openDays)}</span>
                <button className="btn sm ghost" onClick={() => call('shell:openExternal', j.url)}><ExternalLink size={14} /> View</button>
                {trackedIds.has(j.id)
                  ? <button className="btn sm" onClick={() => go('applications')}><Check size={14} /> Tracked</button>
                  : <button className="btn sm primary" onClick={() => onTrack(j.id)}><Plus size={14} /> Track</button>}
                <button className="icon-btn" title="Not for me" onClick={() => onDismiss(j.id)}><EyeOff size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {m.missed.length ? (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="small muted">Every matching role that came down before you applied. A copy of the description is saved while each role is live.</div>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 220 }}>
              <option value="all">All missed ({m.missed.length})</option>
              <option value="30">Last 30 days ({m.last30})</option>
              <option value="saved">Saved, never sent ({m.savedNotApplied})</option>
            </select>
          </div>
          <div className="list">
            {shown.map(({ job: j, saved, openDays }) => {
              const people = peopleAt(j.company)
              return (
                <div key={j.id} className="item">
                  <Avatar name={j.company} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 650 }} className="ellipsis">{j.title}</span>
                      <span className="pill bad" title={`Last seen live ${fmtDate(j.lastSeen)}; confirmed taken down ${fmtDate(j.goneAt)}`}>Gone by {fmtDate(j.goneAt)}</span>
                      {saved && <span className="pill gold">Saved, never sent</span>}
                    </div>
                    <div className="small muted ellipsis">
                      {j.company}{j.location ? ` · ${j.location}` : ''}{postedOn(j) ? ` · posted ${fmtDate(postedOn(j)!)}` : ''} · {openDays < 1
                        ? `on your radar only on ${fmtDate(j.firstSeen)}`
                        : `on your radar ${fmtDate(j.firstSeen)} – ${fmtDate(j.lastSeen)} · you had ${fmtDays(openDays)}+`}
                    </div>
                    {j.relevanceReason && <div className="tiny" style={{ color: 'var(--blue-2)', marginTop: 3 }}>{j.relevanceReason}</div>}
                  </div>
                  {hasCopy(j) && <button className="btn sm ghost" onClick={() => setReading(j)}><FileText size={14} /> Saved copy</button>}
                  {people > 0 && <button className="btn sm ghost" title={`People you've mapped at ${j.company}`} onClick={() => go('people', j.company)}><Users size={14} /> {people}</button>}
                  <button className="btn sm ghost" title="Talk it through with your coach"
                    onClick={() => go('coach', `The ${j.title} role at ${j.company} closed before I applied — it was on my radar for at least ${fmtDays(openDays)}. Help me see what got in the way, and set things up so I catch the next one like it.`)}>
                    <MessageCircle size={14} /></button>
                  <button className="icon-btn" title="Original listing (probably taken down)" onClick={() => call('shell:openExternal', j.url)}><ExternalLink size={15} /></button>
                  <button className="icon-btn" title="Wasn’t a fit — take it off this list" onClick={() => onDismiss(j.id)}><EyeOff size={15} /></button>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <Empty title={m.closedTotal ? 'Nothing missed — every closed match had your application' : 'No matching role has closed yet'}>
          When a matching role comes down before you apply, it shows up here with a saved copy of the description and how long you had.
          Each sweep checks the listing itself before calling a role closed.
        </Empty>
      )}

      {reading && <SavedCopy job={reading} onClose={() => setReading(null)} />}
    </>
  )
}

function SavedCopy({ job, onClose }: { job: Job; onClose: () => void }) {
  const [entry, setEntry] = useState<JobCacheEntry | null | undefined>(undefined)
  useEffect(() => { call<JobCacheEntry | null>('jobs:cached', job.id).then(setEntry).catch(() => setEntry(null)) }, [job.id])
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 4 }}>{job.title}</h2>
      <div className="small muted" style={{ marginBottom: 14 }}>
        {job.company}{job.location ? ` · ${job.location}` : ''}{entry ? ` · copy saved ${fmtDate(entry.at)}` : ''}
      </div>
      {entry === undefined ? <Spinner /> : entry ? (
        <>
          {entry.generic && <div className="tiny muted" style={{ marginBottom: 8 }}>Copied from the careers page itself, so a little site text may have come along.</div>}
          <div className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto', lineHeight: 1.55, paddingRight: 6 }}>{entry.text}</div>
        </>
      ) : (
        <div className="small muted">No copy was kept for this one — it came down before the radar started saving descriptions. Every match from now on is saved while it’s live.</div>
      )}
    </Modal>
  )
}
