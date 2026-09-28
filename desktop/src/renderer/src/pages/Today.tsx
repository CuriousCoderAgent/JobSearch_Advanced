import { useEffect, useState } from 'react'
import { ArrowRight, Bell, CalendarClock, RefreshCw, Sparkles, Target, TrendingUp } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Avatar, Bar, Ring, Spinner, daysAgo, fmtDate, scoreTone } from '../components/ui'
import type { DailyBrief } from '../../../shared/types'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Today() {
  const { state, go, patch, run } = useDesk()
  const { applications: apps, questions, practice, jobs, settings, profile } = state
  const [briefBusy, setBriefBusy] = useState(false)

  const loadBrief = async (force = false): Promise<void> => {
    setBriefBusy(true)
    const b = await run(() => call<DailyBrief>('coach:brief', force))
    if (b) patch((s) => ({ ...s, brief: b }))
    setBriefBusy(false)
  }
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (state.hasKey && state.brief?.day !== today) loadBrief()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const count = (s: string): number => apps.filter((a) => a.status === s).length
  const ready = questions.filter((q) => q.readiness === 'ready').length
  const readiness = questions.length ? Math.round((ready / questions.length) * 100) : 0
  const scored = practice.filter((p) => p.feedback)
  const avgScore = scored.length ? Math.round(scored.slice(-5).reduce((s, p) => s + p.feedback!.overall, 0) / Math.min(5, scored.length)) : null
  const freshJobs = jobs.filter((j) => daysAgo(j.firstSeen) < 3).slice(0, 5)
  const upcoming = apps.filter((a) => a.status !== 'closed' && a.nextStepDate).sort((a, b) => a.nextStepDate!.localeCompare(b.nextStepDate!)).slice(0, 4)

  const actions: { text: string; to: Parameters<typeof go>[0]; focus?: string }[] = []
  for (const a of apps.filter((x) => x.status === 'applied' && x.appliedAt && daysAgo(x.appliedAt) >= 7).slice(0, 2)) {
    actions.push({ text: `Follow up with ${a.company} — applied ${daysAgo(a.appliedAt)} days ago with no update`, to: 'applications', focus: a.id })
  }
  for (const a of apps.filter((x) => x.status === 'interviewing').slice(0, 2)) {
    const qs = questions.filter((q) => q.applicationId === a.id)
    actions.push(qs.length
      ? { text: `Prep for ${a.company}: ${qs.filter((q) => q.readiness !== 'ready').length} company questions still not interview-ready`, to: 'prep', focus: a.id }
      : { text: `Generate the likely interview questions for ${a.company}`, to: 'prep', focus: a.id })
  }
  if (freshJobs.length) actions.push({ text: `${freshJobs.length} new matching roles on the radar — shortlist the best`, to: 'jobs' })
  const nextQ = questions.find((q) => q.myAnswer && q.readiness !== 'ready' && q.attempts === 0)
  if (nextQ) actions.push({ text: `Record a spoken practice of “${nextQ.text}”`, to: 'practice', focus: nextQ.id })
  if (!state.cvs.length) actions.push({ text: 'Import your CV so the coach can personalise everything', to: 'cvs' })

  const first = profile.name?.split(' ')[0] || 'there'
  const brief = state.brief

  return (
    <div className="page">
      <div className="hero" style={{ marginBottom: 18 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 760 }}>
            <div className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1>{greeting()}, {first}.</h1>
            {brief ? (
              <>
                <div style={{ fontSize: 17, marginTop: 10, color: 'var(--gold-2)', fontWeight: 650 }}>{brief.headline}</div>
                <ol style={{ margin: '12px 0 0', paddingLeft: 20, display: 'grid', gap: 6, color: 'var(--text)' }}>
                  {brief.focus.map((f, i) => <li key={i}>{f}</li>)}
                </ol>
                <div className="muted" style={{ marginTop: 12, fontStyle: 'italic' }}>{brief.pepTalk}</div>
              </>
            ) : (
              <div className="muted" style={{ marginTop: 10, fontSize: 15 }}>
                {state.hasKey ? (briefBusy ? 'Your coach is reading your pipeline…' : 'Your daily brief will appear here.') : 'Add your Anthropic key in Settings and your coach will brief you here every morning.'}
              </div>
            )}
          </div>
          {state.hasKey && (
            <button className="btn ghost sm" onClick={() => loadBrief(true)} disabled={briefBusy}>
              {briefBusy ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh brief
            </button>
          )}
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="row between"><div className="stat-label">Applications this week</div><Target size={16} color="var(--muted)" /></div>
          <div className="stat-num" style={{ margin: '8px 0 10px' }}>{state.week.applications}<span className="muted" style={{ fontSize: 16 }}> / {settings.weeklyApplications}</span></div>
          <Bar value={state.week.applications} max={settings.weeklyApplications} tone="gold" />
        </div>
        <div className="card">
          <div className="row between"><div className="stat-label">Practice sessions this week</div><TrendingUp size={16} color="var(--muted)" /></div>
          <div className="stat-num" style={{ margin: '8px 0 10px' }}>{state.week.practice}<span className="muted" style={{ fontSize: 16 }}> / {settings.weeklyPractice}</span></div>
          <Bar value={state.week.practice} max={settings.weeklyPractice} tone="good" />
        </div>
        <div className="card row" style={{ gap: 16 }}>
          <Ring value={readiness} size={76} color="var(--gold)" label={<div className="ring-num" style={{ fontSize: 18 }}>{readiness}%</div>} />
          <div><div className="stat-label">Interview readiness</div><div style={{ fontWeight: 650, marginTop: 4 }}>{ready} of {questions.length} answers ready</div>
            <button className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => go('prep')}>Open prep <ArrowRight size={13} /></button></div>
        </div>
        <div className="card row" style={{ gap: 16 }}>
          <Ring value={avgScore ?? 0} size={76} color={avgScore != null ? scoreTone(avgScore) : 'var(--line)'}
            label={<div className="ring-num" style={{ fontSize: 18 }}>{avgScore ?? '—'}</div>} />
          <div><div className="stat-label">Recent practice score</div><div style={{ fontWeight: 650, marginTop: 4 }}>{scored.length ? `Avg of last ${Math.min(5, scored.length)}` : state.practice.length ? 'Recorded, not scored yet' : 'No recordings yet'}</div>
            <button className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => go('practice')}>Practice now <ArrowRight size={13} /></button></div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.35fr 1fr', gap: 16 }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-title"><Sparkles size={17} color="var(--gold)" /> Next best actions</div>
            {actions.length ? (
              <div className="list">
                {actions.slice(0, 6).map((a, i) => (
                  <div key={i} className="item clickable" onClick={() => go(a.to, a.focus)}>
                    <span className="pill gold">{i + 1}</span>
                    <span className="grow">{a.text}</span>
                    <ArrowRight size={15} color="var(--muted)" />
                  </div>
                ))}
              </div>
            ) : <div className="muted">You’re on top of everything. Add target companies or record a practice answer to keep momentum.</div>}
          </div>

          <div className="card">
            <div className="card-title">Pipeline <span className="sub">{apps.filter((a) => a.status !== 'closed').length} active</span></div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[['saved', 'Saved', 'var(--muted)'], ['applied', 'Applied', 'var(--blue)'], ['screening', 'Screening', 'var(--violet)'], ['interviewing', 'Interviewing', 'var(--gold)'], ['offer', 'Offer', 'var(--good)']].map(([id, label, color]) => (
                <div key={id} className="item clickable" style={{ display: 'block', textAlign: 'center' }} onClick={() => go('applications')}>
                  <div className="stat-num" style={{ color, fontSize: 26 }}>{count(id)}</div>
                  <div className="stat-label">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-title"><CalendarClock size={17} color="var(--blue-2)" /> Coming up</div>
            {upcoming.length ? (
              <div className="list">
                {upcoming.map((a) => (
                  <div key={a.id} className="item clickable" onClick={() => go('applications', a.id)}>
                    <Avatar name={a.company} size={32} />
                    <div className="grow"><div style={{ fontWeight: 650 }} className="ellipsis">{a.nextStep || 'Next step'}</div><div className="small muted ellipsis">{a.company} · {a.role}</div></div>
                    <span className="pill blue">{fmtDate(a.nextStepDate)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="muted small">Add a next step and date to any application and it shows up here.</div>}
          </div>
          <div className="card">
            <div className="card-title"><Bell size={17} color="var(--gold)" /> Fresh on the radar</div>
            {freshJobs.length ? (
              <div className="list">
                {freshJobs.map((j) => (
                  <div key={j.id} className="item clickable" onClick={() => go('jobs')}>
                    <Avatar name={j.company} size={32} />
                    <div className="grow"><div style={{ fontWeight: 650 }} className="ellipsis">{j.title}</div><div className="small muted ellipsis">{j.company}{j.location ? ` · ${j.location}` : ''}</div></div>
                  </div>
                ))}
              </div>
            ) : <div className="muted small">No new matches in the last 3 days. Run a sweep from the Jobs page.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
