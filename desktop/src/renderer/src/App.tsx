import {
  BookOpenCheck, FileText, Flame, KanbanSquare, MessageCircle, Mic, Radar, Settings as SettingsIcon, Sun
} from 'lucide-react'
import { DeskProvider, useDesk, type Page } from './lib/desk'
import { usd } from './components/ui'
import Today from './pages/Today'
import Jobs from './pages/Jobs'
import Applications from './pages/Applications'
import CvStudio from './pages/CvStudio'
import Prep from './pages/Prep'
import Practice from './pages/Practice'
import Coach from './pages/Coach'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'

const NAV: { id: Page; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'jobs', label: 'Jobs', icon: Radar },
  { id: 'applications', label: 'Applications', icon: KanbanSquare },
  { id: 'cvs', label: 'CV Studio', icon: FileText },
  { id: 'prep', label: 'Interview Prep', icon: BookOpenCheck },
  { id: 'practice', label: 'Practice', icon: Mic },
  { id: 'coach', label: 'Coach', icon: MessageCircle }
]

function Shell() {
  const { state, page, go } = useDesk()
  if (!state.settings.onboarded) return <Onboarding />
  const newJobs = state.jobs.filter((j) => Date.now() - new Date(j.firstSeen).getTime() < 3 * 864e5).length
  const upcoming = state.applications.filter((a) => a.status === 'interviewing').length
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="logo">
          <div className="logo-mark" />
          <div>
            <div className="logo-name">JobRadar Desk</div>
            <div className="logo-sub">{state.profile.name ? `${state.profile.name.split(' ')[0]}'s war room` : 'Your war room'}</div>
          </div>
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item ${page === id ? 'on' : ''}`} onClick={() => go(id)}>
            <Icon size={17} />
            {label}
            {id === 'jobs' && newJobs > 0 && <span className="badge">{newJobs}</span>}
            {id === 'applications' && upcoming > 0 && <span className="badge">{upcoming}</span>}
          </button>
        ))}
        <div className="nav-sep" />
        <button className={`nav-item ${page === 'settings' ? 'on' : ''}`} onClick={() => go('settings')}>
          <SettingsIcon size={17} /> Settings
        </button>
        <div className="sidebar-foot">
          <div className="streak">
            <Flame size={22} color="var(--gold)" />
            <div><b>{state.streak}</b> <span>day streak<br />{state.streak ? 'Keep it alive today' : 'Start one today'}</span></div>
          </div>
          <div className="spend">AI this month: <b>{usd(state.usage.total)}</b>{state.settings.monthlyBudgetUsd ? ` / ${usd(state.settings.monthlyBudgetUsd)}` : ''}</div>
        </div>
      </nav>
      <main className="main">
        {page === 'today' && <Today />}
        {page === 'jobs' && <Jobs />}
        {page === 'applications' && <Applications />}
        {page === 'cvs' && <CvStudio />}
        {page === 'prep' && <Prep />}
        {page === 'practice' && <Practice />}
        {page === 'coach' && <Coach />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <DeskProvider>
      {(ready) => (ready ? <Shell /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>Loading your desk…</div>)}
    </DeskProvider>
  )
}
