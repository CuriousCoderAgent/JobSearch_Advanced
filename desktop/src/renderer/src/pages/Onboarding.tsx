import { useState } from 'react'
import { ArrowRight, Check, FileUp, KeyRound, Plus } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Spinner } from '../components/ui'
import { ROLE_FOCUS, type CvVersion, type Profile, type RoleFocus } from '../../../shared/types'

export const STARTER_COMPANIES = [
  'Salesforce', 'ServiceNow', 'Oracle', 'Adobe', 'Cisco', 'Freshworks', 'Databricks', 'Snowflake',
  'MongoDB', 'Workday', 'Nvidia', 'Mastercard', 'Accenture', 'Genpact', 'EY', 'PwC', 'KPMG', 'Amazon', 'BrowserStack', 'Kyndryl'
]

export default function Onboarding() {
  const { state, refresh, run, toast } = useDesk()
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<Profile>(state.profile)
  const [key, setKey] = useState('')
  const [keyOk, setKeyOk] = useState(state.hasKey)
  const [busy, setBusy] = useState(false)
  const [cv, setCv] = useState<CvVersion | undefined>(state.cvs[0])
  const [picked, setPicked] = useState<string[]>([])
  const [jr, setJr] = useState({ url: 'https://job-search-advanced.vercel.app', username: '', password: '' })
  const upd = (patch: Partial<Profile>): void => setProfile((p) => ({ ...p, ...patch }))

  const saveKey = async (): Promise<void> => {
    setBusy(true)
    const ok = await run(async () => { await call('key:set', key); await call('key:test'); return true })
    setKeyOk(!!ok)
    if (ok) toast('Key works — the coach is online.', 'good')
    setBusy(false)
  }
  const importCv = async (): Promise<void> => {
    const c = await run(() => call<CvVersion | null>('cvs:import'))
    if (c) { setCv(c); toast(`Imported "${c.name}" as your master CV.`, 'good') }
  }
  const importJobRadar = async (): Promise<void> => {
    setBusy(true)
    const r = await run(() => call<{ addedCompanies: number; addedApps: number }>('import:jobradar', jr.url, jr.username, jr.password))
    if (r) toast(`Imported ${r.addedCompanies} companies and ${r.addedApps} tracked jobs from JobRadar.`, 'good')
    setBusy(false)
  }
  const finish = async (): Promise<void> => {
    setBusy(true)
    await run(async () => {
      await call('profile:save', { ...profile, masterCvId: profile.masterCvId || cv?.id })
      for (const name of picked) { try { await call('companies:add', name) } catch { /* already added */ } }
      await call('settings:save', { ...state.settings, onboarded: true })
      await refresh()
    })
    setBusy(false)
  }

  const steps = ['About you', 'Your AI coach', 'Your CV', 'Target companies']
  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'grid', placeItems: 'center', padding: 30 }}>
      <div style={{ width: 'min(760px, 100%)' }}>
        <div className="row" style={{ marginBottom: 22 }}>
          <div className="logo-mark" />
          <div>
            <div className="eyebrow" style={{ margin: 0 }}>JobRadar Desk</div>
            <h1 style={{ fontSize: 28 }}>Let’s set up your job-switch war room</h1>
          </div>
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 18 }}>
          {steps.map((s, i) => (
            <div key={s} className="grow">
              <div className={`bar ${i <= step ? 'gold' : ''}`}><i style={{ width: i <= step ? '100%' : '0%' }} /></div>
              <div className="tiny muted" style={{ marginTop: 6, fontWeight: 650, color: i === step ? 'var(--text)' : undefined }}>{s}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 26 }}>
          {step === 0 && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="grid g2">
                <label className="field">Your name<input value={profile.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Eshan Gupta" /></label>
                <label className="field">Current headline<input value={profile.headline} onChange={(e) => upd({ headline: e.target.value })} placeholder="Enterprise sales leader, 14 yrs B2B SaaS" /></label>
              </div>
              <div className="field" style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-2)' }}>Roles you’re going for <span className="hint" style={{ color: 'var(--muted)', fontWeight: 450 }}>— shapes your job matches and interview questions</span></span>
                <div className="grid g2">
                  {ROLE_FOCUS.map((r) => {
                    const on = profile.targetRoles.includes(r)
                    return (
                      <button key={r} className={`item clickable`} style={{ borderColor: on ? 'var(--blue)' : undefined, background: on ? 'var(--blue-tint)' : undefined, textAlign: 'left', font: 'inherit', color: 'inherit' }}
                        onClick={() => upd({ targetRoles: on ? profile.targetRoles.filter((x) => x !== r) : [...profile.targetRoles, r as RoleFocus] })}>
                        <span className="grow" style={{ fontWeight: 600 }}>{r}</span>
                        {on && <Check size={16} color="var(--blue-2)" />}
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="field">What you want next, in your words
                <textarea rows={3} value={profile.targetBrief} onChange={(e) => upd({ targetBrief: e.target.value })}
                  placeholder="e.g. Enterprise sales leadership in B2B SaaS — Head/VP of Enterprise Sales or Country Manager, owning a number and a team, in Bangalore or Mumbai." />
              </label>
              <label className="field">Locations<input value={profile.locations} onChange={(e) => upd({ locations: e.target.value })} /></label>
            </div>
          )}

          {step === 1 && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="row"><KeyRound color="var(--gold)" /><h3>Connect your Anthropic API key</h3></div>
              <p className="muted" style={{ margin: 0 }}>
                The coach — model answers, critiques, CV tailoring and the spoken-answer reviews — runs on Claude using your own key.
                It’s encrypted with Windows’ own protection and never leaves this PC except to call Anthropic. Get one at
                console.anthropic.com → API keys. Job tracking runs mostly on free public feeds, so it barely uses the key.
              </p>
              <div className="row">
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keyOk ? '•••••••••••• (saved — paste a new one to replace)' : 'sk-ant-…'} />
                <button className="btn primary" disabled={!key.trim() || busy} onClick={saveKey}>{busy ? <Spinner /> : 'Save & test'}</button>
              </div>
              {keyOk && <div className="pill good"><Check size={13} /> Key saved and working</div>}
              <p className="small muted" style={{ margin: 0 }}>You can skip this and add it later in Settings — everything except AI features works without it.</p>
            </div>
          )}

          {step === 2 && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="row"><FileUp color="var(--gold)" /><h3>Import your current CV</h3></div>
              <p className="muted" style={{ margin: 0 }}>Word (.docx) or PDF. It becomes your master CV — the source the coach builds every model answer and tailored version from.</p>
              <div className="row">
                <button className="btn primary" onClick={importCv}><FileUp size={16} /> Choose CV file</button>
                {cv && <span className="pill good"><Check size={13} /> {cv.name}</span>}
              </div>
              <label className="field">A few lines about your experience <span className="hint">— anything the CV doesn’t say: biggest wins, deal sizes, team sizes, what you’re known for</span>
                <textarea rows={6} value={profile.background} onChange={(e) => upd({ background: e.target.value })}
                  placeholder="e.g. 14 years in enterprise SaaS sales across BFSI and manufacturing. Closed ₹120 cr+ in new ARR over 3 years, largest deal ₹28 cr with a top private bank. Built and led a 12-person team across West & South…" />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="stack" style={{ gap: 16 }}>
              <h3>Which companies should the radar watch?</h3>
              <p className="muted" style={{ margin: 0 }}>Pick any to start (you can add more later). Most of these are read from free public job feeds, so tracking them costs nothing.</p>
              <div className="row wrap">
                {STARTER_COMPANIES.map((c) => {
                  const on = picked.includes(c)
                  return (
                    <button key={c} className={`pill ${on ? 'blue' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px', fontSize: 12.5, border: '1px solid var(--line-2)' }}
                      onClick={() => setPicked(on ? picked.filter((x) => x !== c) : [...picked, c])}>
                      {on ? <Check size={12} /> : <Plus size={12} />} {c}
                    </button>
                  )
                })}
              </div>
              <div className="hr" />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Already using the JobRadar web app?</div>
                <div className="small muted" style={{ marginBottom: 10 }}>Bring your companies, tracker and profile across in one go (a one-time copy — the desktop app runs its own cheaper engine from then on).</div>
                <div className="grid g3">
                  <input value={jr.url} onChange={(e) => setJr({ ...jr, url: e.target.value })} placeholder="JobRadar URL" />
                  <input value={jr.username} onChange={(e) => setJr({ ...jr, username: e.target.value })} placeholder="Username" />
                  <input type="password" value={jr.password} onChange={(e) => setJr({ ...jr, password: e.target.value })} placeholder="Password" />
                </div>
                <button className="btn sm" style={{ marginTop: 10 }} disabled={busy || !jr.username || !jr.password} onClick={importJobRadar}>
                  {busy ? <Spinner size={14} /> : 'Import from JobRadar'}
                </button>
              </div>
            </div>
          )}

          <div className="row between" style={{ marginTop: 24 }}>
            <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {step < 3
              ? <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 0 && !profile.name.trim()}>Continue <ArrowRight size={16} /></button>
              : <button className="btn gold lg" onClick={finish} disabled={busy}>{busy ? <Spinner /> : 'Open my desk'} <ArrowRight size={16} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}
