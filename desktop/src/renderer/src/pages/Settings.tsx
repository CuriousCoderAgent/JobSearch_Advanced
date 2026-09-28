import { useState } from 'react'
import { Check, FolderOpen, KeyRound, Save } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Spinner, usd } from '../components/ui'
import { ROLE_FOCUS, type Profile, type RoleFocus, type Settings as S } from '../../../shared/types'

export default function Settings() {
  const { state, patch, run, toast } = useDesk()
  const [p, setP] = useState<Profile>(state.profile)
  const [s, setS] = useState<S>(state.settings)
  const [inc, setInc] = useState(state.settings.includeKeywords.join(', '))
  const [exc, setExc] = useState(state.settings.excludeKeywords.join(', '))
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [jr, setJr] = useState({ url: 'https://job-search-advanced.vercel.app', username: '', password: '' })
  const list = (t: string): string[] => t.split(',').map((x) => x.trim()).filter(Boolean)

  const save = async (): Promise<void> => {
    const nextS = { ...s, includeKeywords: list(inc), excludeKeywords: list(exc) }
    const ok = await run(async () => { await call('profile:save', p); await call('settings:save', nextS); return true }, 'Settings saved.')
    if (ok) patch((st) => ({ ...st, profile: p, settings: nextS }))
  }
  const saveKey = async (): Promise<void> => {
    setBusy(true)
    const ok = await run(async () => { await call('key:set', key); await call('key:test'); return true }, 'Key saved and working.')
    if (ok) { patch((st) => ({ ...st, hasKey: true })); setKey('') }
    setBusy(false)
  }
  const importJr = async (): Promise<void> => {
    setBusy(true)
    const r = await run(() => call<{ addedCompanies: number; addedApps: number }>('import:jobradar', jr.url, jr.username, jr.password))
    if (r) { toast(`Imported ${r.addedCompanies} companies and ${r.addedApps} tracked jobs.`, 'good'); await call('state:get').then(() => window.location.reload()) }
    setBusy(false)
  }

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><div className="eyebrow">Settings</div><div className="page-title">Tune your desk</div></div>
        <button className="btn primary" onClick={save}><Save size={16} /> Save</button>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-title">About you <span className="sub">the coach builds every answer and CV from this</span></div>
          <div className="grid g2" style={{ marginBottom: 12 }}>
            <label className="field">Name<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
            <label className="field">Headline<input value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} /></label>
          </div>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            {ROLE_FOCUS.map((r) => (
              <label key={r} className="check" style={{ marginRight: 14 }}>
                <input type="checkbox" checked={p.targetRoles.includes(r)} onChange={() => setP({ ...p, targetRoles: p.targetRoles.includes(r) ? p.targetRoles.filter((x) => x !== r) : [...p.targetRoles, r as RoleFocus] })} /> {r}
              </label>
            ))}
          </div>
          <label className="field" style={{ marginBottom: 12 }}>What you want next<textarea rows={2} value={p.targetBrief} onChange={(e) => setP({ ...p, targetBrief: e.target.value })} /></label>
          <label className="field" style={{ marginBottom: 12 }}>Background & wins<textarea rows={6} value={p.background} onChange={(e) => setP({ ...p, background: e.target.value })} /></label>
          <label className="field">Locations<input value={p.locations} onChange={(e) => setP({ ...p, locations: e.target.value })} /></label>
        </div>

        <div className="card">
          <div className="card-title"><KeyRound size={16} color="var(--gold)" /> Anthropic API key {state.hasKey && <span className="pill good"><Check size={12} /> connected</span>}</div>
          <div className="row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={state.hasKey ? 'Paste a new key to replace the saved one' : 'sk-ant-…'} />
            <button className="btn primary" disabled={!key.trim() || busy} onClick={saveKey}>{busy ? <Spinner /> : 'Save & test'}</button>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Encrypted with Windows data protection. Coaching uses Claude Opus 5; the job engine uses Claude Haiku 4.5 only where free feeds aren’t available.</div>
        </div>

        <div className="card">
          <div className="card-title">AI spend <span className="sub">{state.usage.month}</span></div>
          <div className="row" style={{ gap: 30, marginBottom: 14 }}>
            <div className="stat"><div className="stat-num">{usd(state.usage.total)}</div><div className="stat-label">this month</div></div>
            {Object.entries(state.usage.byFeature).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="stat"><div style={{ fontWeight: 700, fontSize: 17 }}>{usd(v)}</div><div className="stat-label" style={{ textTransform: 'capitalize' }}>{k}</div></div>
            ))}
          </div>
          <label className="field" style={{ maxWidth: 280 }}>Monthly budget cap (USD, 0 = no cap)<input type="number" min={0} value={s.monthlyBudgetUsd} onChange={(e) => setS({ ...s, monthlyBudgetUsd: Number(e.target.value) })} /></label>
        </div>

        <div className="card">
          <div className="card-title">Goals & job matching</div>
          <div className="grid g2" style={{ marginBottom: 12 }}>
            <label className="field">Applications per week<input type="number" min={0} value={s.weeklyApplications} onChange={(e) => setS({ ...s, weeklyApplications: Number(e.target.value) })} /></label>
            <label className="field">Practice sessions per week<input type="number" min={0} value={s.weeklyPractice} onChange={(e) => setS({ ...s, weeklyPractice: Number(e.target.value) })} /></label>
          </div>
          <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={s.aiMatching} onChange={(e) => setS({ ...s, aiMatching: e.target.checked })} /> Let AI judge seniority & fit of brand-new listings (a fraction of a cent per sweep)</label>
          <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={s.indiaOnly} onChange={(e) => setS({ ...s, indiaOnly: e.target.checked })} /> Only India-based or remote roles</label>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={s.autoSweep} onChange={(e) => setS({ ...s, autoSweep: e.target.checked })} /> Sweep automatically every 12 hours while the app is open, and notify me about new matches and upcoming interviews</label>
          <label className="field" style={{ marginBottom: 12 }}>Title must contain one of <span className="hint">(comma-separated)</span><textarea rows={3} value={inc} onChange={(e) => setInc(e.target.value)} /></label>
          <label className="field">Skip titles containing<textarea rows={2} value={exc} onChange={(e) => setExc(e.target.value)} /></label>
        </div>

        <div className="card">
          <div className="card-title">Import from JobRadar <span className="sub">one-time copy of companies, tracker & profile</span></div>
          <div className="grid g3">
            <input value={jr.url} onChange={(e) => setJr({ ...jr, url: e.target.value })} />
            <input value={jr.username} onChange={(e) => setJr({ ...jr, username: e.target.value })} placeholder="Username" />
            <input type="password" value={jr.password} onChange={(e) => setJr({ ...jr, password: e.target.value })} placeholder="Password" />
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} disabled={busy || !jr.username || !jr.password} onClick={importJr}>Import</button>
        </div>

        <div className="card row between">
          <div><b>Your files</b><div className="small muted">{state.deskRoot}</div></div>
          <button className="btn" onClick={() => call('shell:openPath', state.deskRoot)}><FolderOpen size={15} /> Open folder</button>
        </div>
      </div>
    </div>
  )
}
