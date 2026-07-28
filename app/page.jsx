"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const KEY_STORE = "jobradar-session";
const NAME_STORE = "jobradar-username";
const THEME_STORE = "jobradar-theme";
const TOUR_STORE = "jobradar-tour-seen";

function useAppKey() {
  const [appKey, setAppKey] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { setAppKey(localStorage.getItem(KEY_STORE) || ""); setReady(true); }, []);
  const save = (k) => { localStorage.setItem(KEY_STORE, k); setAppKey(k); };
  return [appKey, save, ready];
}

function useTheme() {
  const [theme, setTheme] = useState("system");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    setTheme(localStorage.getItem(THEME_STORE) || "system");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const isDark = theme === "dark" || (theme === "system" && systemDark);
  const toggle = () => {
    const next = isDark ? "light" : "dark";
    localStorage.setItem(THEME_STORE, next);
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  };
  return [isDark, toggle];
}

function ThemeToggle() {
  const [isDark, toggle] = useTheme();
  return (
    <button className="theme-toggle" aria-label="Toggle dark mode" onClick={toggle} title="Toggle dark mode">
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}

async function api(path, appKey, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-session": appKey, ...(opts.headers || {}) }
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

export default function Home() {
  const [appKey, saveKey, keyReady] = useAppKey();
  const [unlocked, setUnlocked] = useState(false);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState("radar");
  const [showTour, setShowTour] = useState(false);

  const [sweep, setSweep] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [settings, setSettings] = useState(null);
  const [cvs, setCvs] = useState([]);
  const [email, setEmail] = useState("");
  const [applications, setApplications] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState("");

  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  async function loadAll(k) {
    const [s, c, st, cv, acc, apps] = await Promise.all([
      api("/api/scan", k), api("/api/companies", k), api("/api/settings", k), api("/api/cvs", k),
      api("/api/account", k), api("/api/applications", k)
    ]);
    setSweep(s.sweep); setCompanies(c.companies); setSettings(st.settings); setCvs(cv.cvs);
    setEmail(acc.email || ""); setApplications(apps.applications || []);
    api("/api/admin/users", k).then(() => setIsAdmin(true)).catch(() => setIsAdmin(false));
    setUnlocked(true);
  }

  function signOut() {
    saveKey("");
    localStorage.removeItem(KEY_STORE);
    localStorage.removeItem(NAME_STORE);
    setUnlocked(false);
    setSweep(null); setCompanies([]); setSettings(null); setCvs([]);
    setEmail(""); setApplications([]); setIsAdmin(false); setTab("radar");
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    if (!keyReady) return;
    if (appKey) loadAll(appKey).catch(() => setUnlocked(false)).finally(() => setBooting(false));
    else setBooting(false);
  }, [appKey, keyReady]);

  if (booting) return <BootSkeleton />;

  if (!unlocked) {
    return (
      <Gate onUnlock={async (k, justSignedUp) => {
        try {
          await loadAll(k); saveKey(k);
          if (justSignedUp && !localStorage.getItem(TOUR_STORE)) setShowTour(true);
          if (justSignedUp) {
            setScanning(true);
            try { const r = await api("/api/scan", k, { method: "POST" }); setSweep(r.sweep); }
            catch { /* first sweep is a nice-to-have, not required for signup to succeed */ }
            setScanning(false);
          }
        } catch (e) { throw e; }
      }} />
    );
  }

  const allMatches = sweep ? sweep.results.flatMap((r) => r.matches) : [];
  const newMatches = allMatches.filter((m) => m.isNew);

  async function scanNow() {
    setScanning(true);
    try { const r = await api("/api/scan", appKey, { method: "POST" }); setSweep(r.sweep); say(`Sweep done — ${r.sweep.newCount} new match${r.sweep.newCount === 1 ? "" : "es"}.`); }
    catch (e) { say(e.message); }
    setScanning(false);
  }

  async function trackJob(m) {
    if (applications.some((a) => a.id === m.id)) { say("Already in your tracker."); return; }
    const entry = { id: m.id, title: m.title, company: m.company, url: m.url, location: m.location || "", status: "saved", addedAt: new Date().toISOString() };
    const list = [entry, ...applications];
    setApplications(list);
    try { await api("/api/applications", appKey, { method: "POST", body: JSON.stringify({ applications: list }) }); say("Added to your tracker."); }
    catch (e) { say(e.message); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">JobRadar</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-note">Daily sweep · 5:00 PM IST</span>
          {isAdmin && (
            <button className="theme-toggle" aria-label="Admin dashboard" title="Admin dashboard" onClick={() => setTab("admin")}>
              <TabIcon id="admin" />
            </button>
          )}
          <ThemeToggle />
          <button className="signout" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {showTour && <OnboardingTour onDone={() => { localStorage.setItem(TOUR_STORE, "1"); setShowTour(false); }} onGo={setTab} />}

      {tab === "radar" && (
        <RadarTab sweep={sweep} scanning={scanning} onScan={scanNow} appKey={appKey} say={say} companies={companies}
          onTailor={(m) => { sessionStorage.setItem("tailor-job", JSON.stringify(m)); setTab("cv"); }}
          onTrack={trackJob} applications={applications}
          onGo={setTab} />
      )}
      {tab === "companies" && (
        <CompaniesTab companies={companies} setCompanies={setCompanies} appKey={appKey} say={say} />
      )}
      {tab === "tracker" && (
        <TrackerTab applications={applications} setApplications={setApplications} appKey={appKey} say={say} />
      )}
      {tab === "cv" && (
        <CvTab cvs={cvs} setCvs={setCvs} appKey={appKey} say={say} matches={allMatches} />
      )}
      {tab === "settings" && settings && (
        <SettingsTab settings={settings} setSettings={setSettings} appKey={appKey} say={say} email={email} setEmail={setEmail} />
      )}
      {tab === "admin" && isAdmin && (
        <AdminTab appKey={appKey} say={say} />
      )}

      {toast && <div className="toast">{toast}</div>}

      <nav className="tabbar">
        {[
          ["radar", "Radar"], ["companies", "Companies"], ["tracker", "Tracker"], ["cv", "CV Studio"], ["settings", "Settings"]
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>
            <TabIcon id={id} />
            <span>{label}</span>
            {id === "radar" && newMatches.length > 0 && <em className="pip">{newMatches.length}</em>}
          </button>
        ))}
      </nav>
    </main>
  );
}

/* ---------- Boot skeleton ---------- */
function BootSkeleton() {
  return (
    <div className="skeleton-shell" aria-busy="true" aria-label="Loading JobRadar">
      <div className="skel" style={{ height: 40, width: 160 }} />
      <div className="skel" style={{ height: 148, width: "100%" }} />
      <div className="skel" style={{ height: 20, width: "45%" }} />
      <div className="skel" style={{ height: 66, width: "100%" }} />
      <div className="skel" style={{ height: 66, width: "100%" }} />
      <div className="skel" style={{ height: 66, width: "100%" }} />
    </div>
  );
}

/* ---------- First-run onboarding tour ---------- */
function OnboardingTour({ onDone, onGo }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: "📡", title: "Meet your Radar", body: "This is the home screen. Run a Sweep any time, or just wait — it checks your companies automatically every day at 5 PM IST and flags anything new." },
    { icon: "🏢", title: "Add target companies", body: "Head to Companies and list 10–30 places you'd love to work. The Radar only watches companies you add, so start there." },
    { icon: "✍️", title: "CV Studio", body: "Pick any matched role — or paste a job description — and Claude will tailor a CV or cover letter from your profile or an existing resume." },
    { icon: "⚙️", title: "Tune your Settings", body: "Fill in your profile and the roles you want. That's what Claude uses to judge relevance and write your CVs — the better it is, the sharper everything else gets." }
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true">
      <div className="tour-card">
        <span className="tour-icon" aria-hidden="true">{s.icon}</span>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <div className="tour-dots">
          {steps.map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}
        </div>
        <div className="tour-actions">
          <button className="linklike" onClick={onDone}>Skip</button>
          <button className="primary" onClick={() => {
            if (last) { onDone(); if (onGo) onGo("companies"); }
            else setStep(step + 1);
          }}>
            {last ? "Add my first companies" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sign in / Sign up ---------- */
function Gate({ onUnlock }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [domain, setDomain] = useState("Sales");
  const [email, setEmail] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const DOMAIN_OPTIONS = ["Finance", "Sales", "Marketing", "IT & Technology",
    "Human Resources", "Operations", "Customer Success & Support", "Consulting & Strategy"];

  async function go() {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, inviteCode, domain, email })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      localStorage.setItem(NAME_STORE, j.username);
      await onUnlock(j.token, mode === "signup");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function sendResetLink() {
    setBusy(true); setErr(""); setNotice("");
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      setNotice(j.message || "If that email is registered, a reset link is on its way.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (mode === "forgot") {
    return (
      <main className="gate">
        <div className="gate-card">
          <span className="brand-mark big" aria-hidden="true" />
          <h1>JobRadar</h1>
          <p>Enter the email on your account and we'll send a reset link.</p>
          <input type="email" value={forgotEmail} placeholder="Email address" autoCapitalize="none"
            onChange={(e) => setForgotEmail(e.target.value)} />
          <button className="primary" disabled={busy || !forgotEmail.trim()} onClick={sendResetLink}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          {notice && <p className="ok">{notice}</p>}
          {err && <p className="err">{err}</p>}
          <button className="linklike" onClick={() => { setMode("login"); setErr(""); setNotice(""); }}>Back to sign in</button>
        </div>
      </main>
    );
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>JobRadar</h1>
        <p>{mode === "login" ? "Sign in to open your radar." : "Create your account to start your own radar."}</p>
        <input value={username} placeholder="Username" autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} placeholder={mode === "login" ? "Password" : "Choose a password (8+ characters)"} onChange={(e) => setPassword(e.target.value)} />
        {mode === "signup" && (
          <>
            <input value={inviteCode} placeholder="Invite code" autoCapitalize="none" onChange={(e) => setInviteCode(e.target.value)} />
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              {DOMAIN_OPTIONS.map((d) => <option key={d} value={d}>My field: {d}</option>)}
            </select>
            <input type="email" value={email} placeholder="Email — for your 5 PM digest and password recovery"
              onChange={(e) => setEmail(e.target.value)} />
          </>
        )}
        <button className="primary" disabled={busy || !username || !password} onClick={go}>
          {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {err && <p className="err">{err}</p>}
        <button className="linklike" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
        {mode === "login" && (
          <button className="linklike" onClick={() => { setMode("forgot"); setErr(""); }}>Forgot password?</button>
        )}
      </div>
    </main>
  );
}

/* ---------- Getting started checklist ---------- */
function GettingStarted({ companies, sweep, onGo }) {
  const notified = typeof Notification !== "undefined" && Notification.permission === "granted";
  const steps = [
    { done: companies.length > 0, label: "Add a few target companies", go: "companies" },
    { done: !!sweep, label: "Run your first sweep", go: null },
    { done: notified, label: "Turn on 5 PM alerts", go: null },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="checklist">
      <h3>Get set up — 3 quick steps</h3>
      <ul>
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "done" : ""}>
            <span className="step-dot">{s.done ? "✓" : i + 1}</span>
            {s.go ? <button className="linklike" onClick={() => onGo(s.go)}>{s.label}</button> : <span>{s.label}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Radar ---------- */
function RadarTab({ sweep, scanning, onScan, appKey, say, onTailor, companies, onGo, onTrack, applications }) {
  const matches = sweep ? sweep.results.flatMap((r) => r.matches) : [];
  const manual = sweep ? sweep.results.filter((r) => r.status === "manual") : [];
  const when = sweep ? new Date(sweep.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <section className="pane">
      <GettingStarted companies={companies} sweep={sweep} onGo={onGo} />
      <div className={"dial-card" + (scanning ? " sweeping" : "")}>
        <div className="dial" role="img" aria-label="Sweep status">
          <div className="dial-ring" />
          <div className="dial-core">
            {sweep ? (
              <>
                <strong>{sweep.matchCount}</strong>
                <span>match{sweep.matchCount === 1 ? "" : "es"} live</span>
              </>
            ) : (
              <>
                <strong>—</strong>
                <span>no sweep yet</span>
              </>
            )}
          </div>
        </div>
        <div className="dial-side">
          <h2>{scanning ? "Sweeping your companies…" : sweep ? `${sweep.companiesScanned} companies scanned` : "Ready for the first sweep"}</h2>
          <p className="muted">{sweep ? `Last sweep ${when} · ${sweep.newCount} new · matched by ${sweep.matchMode || "keywords"}` : "Add your target companies in the Companies tab, then run your first sweep — after that it happens automatically at 5 PM."}</p>
          <div className="row">
            <button className="primary" onClick={onScan} disabled={scanning}>{scanning ? "Scanning…" : "Sweep now"}</button>
            <NotifyButton appKey={appKey} say={say} />
          </div>
        </div>
      </div>

      {sweep && (
        <details className="sweepdetails">
          <summary>Sweep details — what the radar saw per company</summary>
          <ul>
            {sweep.results.map((r) => (
              <li key={r.company}>
                <b>{r.company}</b>{" — "}
                {r.status === "manual"
                  ? "couldn't read this company's page (manual link shown below)"
                  : `read via ${r.status}: ${r.total ?? 0} roles seen, ${r.matches.length} matched your keywords`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {matches.length > 0 && (
        <>
          <h3 className="section-label">Relevant openings</h3>
          <ul className="jobs">
            {matches.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)).map((m) => (
              <li key={m.id} className="job">
                <Avatar name={m.company} />
                <div className="job-main">
                  <span className="job-title">{m.title} {m.isNew && <em className="new">NEW</em>}</span>
                  <span className="job-meta">{m.company}{m.location ? ` · ${m.location}` : ""}</span>
                </div>
                <div className="job-actions">
                  <a className="ghost" href={m.url} target="_blank" rel="noreferrer">View</a>
                  <button className="ghost" onClick={() => onTailor(m)}>Tailor CV</button>
                  {applications.some((a) => a.id === m.id)
                    ? <span className="ok">Tracked ✓</span>
                    : <button className="ghost" onClick={() => onTrack(m)}>Track</button>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {sweep && matches.length === 0 && (
        <div className="empty">No relevant openings right now across your list. The radar keeps watching — you'll hear at 5 PM the day something appears.</div>
      )}

      {manual.length > 0 && (
        <>
          <h3 className="section-label">No public job feed — add their careers page URL in Companies to automate, or check manually</h3>
          <ul className="chips">
            {manual.map((r) => (
              <li key={r.company}><a href={r.link} target="_blank" rel="noreferrer">{r.company} ↗</a></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function NotifyButton({ appKey, say }) {
  const [state, setState] = useState("idle");
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") setState("on");
  }, []);
  async function enable() {
    try {
      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") { say("On iPad: add JobRadar to your Home Screen first, then enable alerts from there."); return; }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { say("Notifications were not allowed."); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api("/api/push/key", appKey);
      if (!key) { say("VAPID keys missing — see README step 5."); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
      await api("/api/push/subscribe", appKey, { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      setState("on"); say("Daily 5 PM alerts are on for this device.");
    } catch (e) { say("Couldn't enable alerts: " + e.message); }
  }
  return state === "on"
    ? <span className="ok">5 PM alerts on ✓</span>
    : <button className="ghost" onClick={enable}>Enable 5 PM alerts</button>;
}
function urlB64(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* ---------- Company initial avatar ---------- */
const AVATAR_COLORS = ["#3d4c9e", "#2f9e77", "#c0392b", "#8e44ad", "#c1791e", "#1f7a8c", "#a13d63", "#4c6b3d"];
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function Avatar({ name }) {
  const color = AVATAR_COLORS[hashStr(name || "") % AVATAR_COLORS.length];
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return <span className="avatar" style={{ background: color }} aria-hidden="true">{initial}</span>;
}

/* ---------- Tab bar icons ---------- */
function TabIcon({ id }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  if (id === "radar") return (
    <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v3M21.5 12h-3M12 21.5v-3M2.5 12h3" /></svg>
  );
  if (id === "companies") return (
    <svg {...common}><rect x="4" y="9" width="7" height="11" /><rect x="13" y="4" width="7" height="16" /><path d="M6.5 12.5h2M6.5 15.5h2M15.5 7.5h2M15.5 10.5h2M15.5 13.5h2" /></svg>
  );
  if (id === "cv") return (
    <svg {...common}><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /><path d="M8 13h8M8 16.5h8M8 9.5h4" /></svg>
  );
  if (id === "tracker") return (
    <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M7 13.5l2 2 4-4.5" /></svg>
  );
  if (id === "admin") return (
    <svg {...common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="M9.5 12l1.8 1.8L14.5 10" /></svg>
  );
  return (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.35 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></svg>
  );
}

/* ---------- Companies ---------- */
function CompaniesTab({ companies, setCompanies, appKey, say }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  async function save(list) {
    setCompanies(list);
    try { await api("/api/companies", appKey, { method: "POST", body: JSON.stringify({ companies: list }) }); }
    catch (e) { say(e.message); }
  }
  return (
    <section className="pane">
      <h2 className="pane-title">Target companies <span className="count">{companies.length}</span></h2>
      <p className="muted">The daily 5 PM sweep checks every company here. Start by adding the companies you'd love to work at — dream ones included. The radar finds each one's careers page on its own; no URL needed.</p>
      {companies.some((c) => c.suggested) && (
        <p className="hint">We've pre-loaded a few well-known employers to get you started — remove any that don't fit, or add your own.</p>
      )}
      {companies.length === 0 && (
        <div className="empty">Your list is empty. Add 10–30 target companies to give the radar something to sweep.</div>
      )}
      <div className="row">
        <input value={name} placeholder="Add a company, e.g. Databricks" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="primary" onClick={add} disabled={!name.trim()}>Add</button>
      </div>
      <input value={url} placeholder="Optional: paste a careers URL to point the radar at a specific filtered search"
        onChange={(e) => setUrl(e.target.value)} style={{ marginTop: 8 }} />
      <p className="hint">You only need this if a company doesn't post through a job board the radar already knows, or if you want to narrow it to a specific role/location search on a big careers site.</p>
      <ul className="companies">
        {companies.map((c) => (
          <li key={c.name}>
            <span className="company-row">
              <Avatar name={c.name} />
              {c.name}
              {c.suggested
                ? <em className="src">starter pick</em>
                : c.careersUrl && <em className="src">{c.autoDetected ? "auto-detected" : "smart reader"}</em>}
            </span>
            <button className="x" aria-label={`Remove ${c.name}`} onClick={() => save(companies.filter((x) => x.name !== c.name))}>×</button>
          </li>
        ))}
      </ul>
    </section>
  );
  function add() {
    const n = name.trim();
    if (!n || companies.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
    const entry = { name: n, slug: n.toLowerCase().replace(/[^a-z0-9]/g, "") };
    if (url.trim().startsWith("http")) entry.careersUrl = url.trim();
    save([...companies, entry]);
    setName(""); setUrl("");
  }
}

/* ---------- Application tracker ---------- */
const APP_STATUSES = [
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" }
];

function TrackerTab({ applications, setApplications, appKey, say }) {
  async function save(list) {
    setApplications(list);
    try { await api("/api/applications", appKey, { method: "POST", body: JSON.stringify({ applications: list }) }); }
    catch (e) { say(e.message); }
  }
  const setStatus = (id, status) => save(applications.map((a) => (a.id === id ? { ...a, status, updatedAt: new Date().toISOString() } : a)));
  const remove = (id) => save(applications.filter((a) => a.id !== id));

  return (
    <section className="pane">
      <h2 className="pane-title">Application tracker <span className="count">{applications.length}</span></h2>
      <p className="muted">Tap "Track" on any match in the Radar tab to add it here, then move it along as you apply.</p>
      {applications.length === 0 && (
        <div className="empty">Nothing tracked yet. Go to the Radar tab and tap "Track" on a role you're considering.</div>
      )}
      {APP_STATUSES.map((s) => {
        const items = applications.filter((a) => a.status === s.id);
        if (!items.length) return null;
        return (
          <div key={s.id}>
            <h3 className="section-label">{s.label} <span className="count">{items.length}</span></h3>
            <ul className="jobs">
              {items.map((a) => (
                <li key={a.id} className="job">
                  <Avatar name={a.company} />
                  <div className="job-main">
                    <span className="job-title">{a.title}</span>
                    <span className="job-meta">{a.company}{a.location ? ` · ${a.location}` : ""}</span>
                  </div>
                  <div className="job-actions">
                    <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}>
                      {APP_STATUSES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                    </select>
                    <button className="x" aria-label={`Remove ${a.title}`} onClick={() => remove(a.id)}>×</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/* ---------- CV Studio ---------- */
function CvTab({ cvs, setCvs, appKey, say, matches }) {
  const [job, setJob] = useState(null);
  const [jd, setJd] = useState("");
  const [baseId, setBaseId] = useState("");
  const [mode, setMode] = useState("cv");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("tailor-job");
    if (stored) { setJob(JSON.parse(stored)); sessionStorage.removeItem("tailor-job"); }
  }, []);

  async function saveCvs(list) {
    setCvs(list);
    try { await api("/api/cvs", appKey, { method: "POST", body: JSON.stringify({ cvs: list }) }); }
    catch (e) { say(e.message); }
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      let text = "";
      if (f.name.toLowerCase().endsWith(".docx") && window.mammoth) {
        const buf = await f.arrayBuffer();
        const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
        text = r.value;
      } else if (f.name.toLowerCase().endsWith(".pdf")) {
        if (!window.pdfjsLib) throw new Error("pdf reader still loading");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((it) => it.str).join(" "));
        }
        text = pages.join("\n\n");
      } else {
        text = await f.text();
      }
      if (!text.trim()) throw new Error("empty file");
      const cv = { id: String(Date.now()), name: f.name.replace(/\.(docx|pdf|txt|md)$/i, ""), text: text.slice(0, 40000), addedAt: new Date().toISOString() };
      await saveCvs([cv, ...cvs]);
      setBaseId(cv.id);
      say(`Saved "${cv.name}" — it can now be reworked for any role.`);
    } catch { say("Couldn't read that file. Use .docx, .pdf, or .txt."); }
    e.target.value = "";
  }

  async function tailor() {
    setBusy(true); setOut("");
    try {
      const base = cvs.find((c) => c.id === baseId);
      const r = await api("/api/tailor", appKey, {
        method: "POST",
        body: JSON.stringify({
          jobTitle: job?.title || "", jobCompany: job?.company || "",
          jobDescription: jd, baseCvText: base?.text || "", mode
        })
      });
      setOut(r.text);
    } catch (e) { say(e.message); }
    setBusy(false);
  }

  function download(kind) {
    let blob, fname;
    if (kind === "doc") {
      const html = `<html><head><meta charset="utf-8"></head><body>${out
        .replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/^- (.*)$/gm, "<li>$1</li>").replace(/\n/g, "<br>")}</body></html>`;
      blob = new Blob([html], { type: "application/msword" });
      fname = `CV${job ? " - " + job.company : ""}.doc`;
    } else if (kind === "pdf") {
      if (!window.jspdf) { say("PDF export is still loading — try again in a moment."); return; }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 48;
      const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = margin;
      for (const rawLine of out.split("\n")) {
        const isHeading = /^#{1,3}\s/.test(rawLine);
        const clean = rawLine.replace(/^#{1,3}\s/, "").replace(/\*\*/g, "");
        doc.setFont("helvetica", isHeading ? "bold" : "normal");
        doc.setFontSize(isHeading ? 13 : 10.5);
        const wrapped = clean ? doc.splitTextToSize(clean, maxWidth) : [""];
        for (const w of wrapped) {
          if (y > pageHeight - margin) { doc.addPage(); y = margin; }
          doc.text(w, margin, y);
          y += isHeading ? 18 : 14;
        }
      }
      blob = doc.output("blob");
      fname = `CV${job ? " - " + job.company : ""}.pdf`;
    } else {
      blob = new Blob([out], { type: "text/plain" });
      fname = `CV${job ? " - " + job.company : ""}.txt`;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  }

  return (
    <section className="pane">
      <h2 className="pane-title">CV Studio</h2>

      <label className="lbl">Target role</label>
      {job ? (
        <div className="picked">
          <span>{job.title} — {job.company}</span>
          <button className="x" onClick={() => setJob(null)}>×</button>
        </div>
      ) : (
        <select onChange={(e) => { const m = matches.find((x) => x.id === e.target.value); setJob(m || null); }} defaultValue="">
          <option value="" disabled>Pick from today's matches, or just paste a JD below</option>
          {matches.map((m) => <option key={m.id} value={m.id}>{m.title} — {m.company}</option>)}
        </select>
      )}

      <label className="lbl">Job description (paste for the sharpest tailoring)</label>
      <textarea rows={5} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the JD here…" />

      <label className="lbl">Start from</label>
      <div className="row wrap">
        <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          <option value="">Fresh CV from my profile</option>
          {cvs.map((c) => <option key={c.id} value={c.id}>Rework: {c.name}</option>)}
        </select>
        <button className="ghost" onClick={() => fileRef.current?.click()}>Upload existing CV</button>
        <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" hidden onChange={onFile} />
      </div>

      <div className="row">
        <label className="radio"><input type="radio" checked={mode === "cv"} onChange={() => setMode("cv")} /> CV</label>
        <label className="radio"><input type="radio" checked={mode === "coverletter"} onChange={() => setMode("coverletter")} /> Cover letter</label>
      </div>

      <button className="primary wide" onClick={tailor} disabled={busy}>
        {busy ? "Claude is writing…" : "Create the best-fit version"}
      </button>

      {out && (
        <div className="output">
          <div className="row wrap">
            <button className="ghost" onClick={() => { navigator.clipboard.writeText(out); say("Copied."); }}>Copy</button>
            <button className="ghost" onClick={() => download("doc")}>Download .doc</button>
            <button className="ghost" onClick={() => download("pdf")}>Download .pdf</button>
            <button className="ghost" onClick={() => download("txt")}>Download .txt</button>
          </div>
          <pre>{out}</pre>
        </div>
      )}

      <ScoreSection cvText={out || cvs.find((c) => c.id === baseId)?.text || ""} jd={jd} job={job} appKey={appKey} say={say} />

      {cvs.length > 0 && (
        <>
          <h3 className="section-label">Saved CVs</h3>
          <ul className="companies">
            {cvs.map((c) => (
              <li key={c.id}>
                <span>{c.name}</span>
                <button className="x" onClick={() => saveCvs(cvs.filter((x) => x.id !== c.id))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ---------- CV fit score ---------- */
function ScoreSection({ cvText, jd, job, appKey, say }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    if (!jd.trim()) { say("Paste the job description above first."); return; }
    if (!cvText.trim()) { say("Generate a CV above, or pick a saved one, before scoring."); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api("/api/score", appKey, {
        method: "POST",
        body: JSON.stringify({ cvText, jobTitle: job?.title || "", jobCompany: job?.company || "", jobDescription: jd })
      });
      setResult(r.result);
    } catch (e) { say(e.message); }
    setBusy(false);
  }

  const tier = result ? (result.score >= 75 ? "high" : result.score >= 50 ? "mid" : "low") : "";

  return (
    <div style={{ marginTop: 18 }}>
      <button className="ghost" onClick={run} disabled={busy}>
        {busy ? "Scoring…" : "Score my fit against this JD"}
      </button>
      {result && (
        <div className="score-card">
          <div className="score-head">
            <div className={`score-ring ${tier}`}>{result.score}</div>
            <div>
              <strong>{result.verdict}</strong>
              <p className="muted" style={{ margin: "2px 0 0" }}>Fit score out of 100, judged by Claude against the JD you pasted.</p>
            </div>
          </div>
          <div className="score-cols">
            <div className="score-col">
              <h4>Already strong</h4>
              <ul>{(result.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div className="score-col">
              <h4>Fix before applying</h4>
              <ul>{(result.gaps || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          </div>
          {result.missingKeywords?.length > 0 && (
            <div>
              <h4 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", margin: "0 0 8px" }}>Missing keywords from the JD</h4>
              <ul className="chips" style={{ margin: 0 }}>
                {result.missingKeywords.map((k, i) => <li key={i}><span>{k}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Settings ---------- */
function SettingsTab({ settings, setSettings, appKey, say, email, setEmail }) {
  const [local, setLocal] = useState(settings);
  const [includeText, setIncludeText] = useState((settings.includeKeywords || []).join(", "));
  const [excludeText, setExcludeText] = useState((settings.excludeKeywords || []).join(", "));
  const [emailText, setEmailText] = useState(email || "");
  const [emailBusy, setEmailBusy] = useState(false);
  const upd = (k, v) => setLocal({ ...local, [k]: v });
  const parseList = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);
  async function save() {
    const toSave = { ...local, includeKeywords: parseList(includeText), excludeKeywords: parseList(excludeText) };
    try {
      await api("/api/settings", appKey, { method: "POST", body: JSON.stringify({ settings: toSave }) });
      setSettings(toSave); setLocal(toSave); say("Saved. The next sweep uses these rules.");
    } catch (e) { say(e.message); }
  }
  async function saveEmail() {
    setEmailBusy(true);
    try {
      await api("/api/account", appKey, { method: "POST", body: JSON.stringify({ email: emailText }) });
      setEmail(emailText); say("Email saved.");
    } catch (e) { say(e.message); }
    setEmailBusy(false);
  }
  return (
    <section className="pane">
      <h2 className="pane-title">Settings</h2>

      <label className="lbl">Email — for your 5 PM digest and password recovery</label>
      <div className="row">
        <input type="email" value={emailText} placeholder="you@example.com" onChange={(e) => setEmailText(e.target.value)} />
        <button className="ghost" onClick={saveEmail} disabled={emailBusy || emailText === (email || "")}>
          {emailBusy ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="hint">Without an email, you'll only get alerts through push notifications on this device.</p>

      <label className="lbl">My profile (Claude uses this to tailor CVs)</label>
      <textarea rows={6} value={local.profile} onChange={(e) => upd("profile", e.target.value)} />

      <label className="lbl">What roles am I looking for? (plain English)</label>
      <textarea rows={3} value={local.targetRoles || ""} placeholder="e.g. Head, Director or VP of Enterprise Sales; Country Manager; National Sales Head — B2B SaaS or enterprise tech, India"
        onChange={(e) => upd("targetRoles", e.target.value)} />

      <label className="radio big">
        <input type="checkbox" checked={local.aiMatch !== false} onChange={(e) => upd("aiMatch", e.target.checked)} />
        Let Claude judge relevance (recommended — no keyword tuning)
      </label>

      <label className="lbl">Fallback keywords (used only if AI matching is off)</label>
      <textarea rows={3} value={includeText} onChange={(e) => setIncludeText(e.target.value)} />

      <label className="lbl">Skip roles containing</label>
      <textarea rows={2} value={excludeText} onChange={(e) => setExcludeText(e.target.value)} />

      <label className="radio big">
        <input type="checkbox" checked={local.indiaOnly} onChange={(e) => upd("indiaOnly", e.target.checked)} />
        Only India-based (or remote) roles
      </label>

      <button className="primary wide" onClick={save}>Save settings</button>
    </section>
  );
}

/* ---------- Admin ---------- */
function AdminTab({ appKey, say }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    try { const r = await api("/api/admin/users", appKey); setRows(r.users); }
    catch (e) { say(e.message); }
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—");

  return (
    <section className="pane">
      <h2 className="pane-title">Admin <span className="count">{rows ? rows.length : ""}</span></h2>
      <p className="muted">Usage across every account — only visible to you.</p>
      {busy && !rows && <div className="empty">Loading…</div>}
      {rows && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th><th>Email</th><th>Domain</th><th>Companies</th><th>CVs</th>
                <th>Tracked</th><th>Sweeps</th><th>Claude calls</th><th>Last active</th><th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.username}>
                  <td>{r.username}</td>
                  <td>{r.email || "—"}</td>
                  <td>{r.domain || "—"}</td>
                  <td>{r.companies}</td>
                  <td>{r.cvs}</td>
                  <td>{r.applications}</td>
                  <td>{r.sweeps}</td>
                  <td>{r.claudeCalls}</td>
                  <td>{fmt(r.lastActive)}</td>
                  <td>{fmt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
