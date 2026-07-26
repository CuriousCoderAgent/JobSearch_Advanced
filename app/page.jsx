"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const KEY_STORE = "jobradar-session";
const NAME_STORE = "jobradar-username";

function useAppKey() {
  const [appKey, setAppKey] = useState("");
  useEffect(() => { setAppKey(localStorage.getItem(KEY_STORE) || ""); }, []);
  const save = (k) => { localStorage.setItem(KEY_STORE, k); setAppKey(k); };
  return [appKey, save];
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
  const [appKey, saveKey] = useAppKey();
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState("radar");

  const [sweep, setSweep] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [settings, setSettings] = useState(null);
  const [cvs, setCvs] = useState([]);
  const [toast, setToast] = useState("");

  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  async function loadAll(k) {
    const [s, c, st, cv] = await Promise.all([
      api("/api/scan", k), api("/api/companies", k), api("/api/settings", k), api("/api/cvs", k)
    ]);
    setSweep(s.sweep); setCompanies(c.companies); setSettings(st.settings); setCvs(cv.cvs);
    setUnlocked(true);
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    if (appKey) loadAll(appKey).catch(() => setUnlocked(false));
  }, [appKey]);

  if (!unlocked) return <Gate onUnlock={async (k) => { try { await loadAll(k); saveKey(k); } catch (e) { throw e; } }} />;

  const allMatches = sweep ? sweep.results.flatMap((r) => r.matches) : [];
  const newMatches = allMatches.filter((m) => m.isNew);

  async function scanNow() {
    setScanning(true);
    try { const r = await api("/api/scan", appKey, { method: "POST" }); setSweep(r.sweep); say(`Sweep done — ${r.sweep.newCount} new match${r.sweep.newCount === 1 ? "" : "es"}.`); }
    catch (e) { say(e.message); }
    setScanning(false);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">JobRadar</span>
        </div>
        <span className="topbar-note">Daily sweep · 5:00 PM IST</span>
      </header>

      {tab === "radar" && (
        <RadarTab sweep={sweep} scanning={scanning} onScan={scanNow} appKey={appKey} say={say}
          onTailor={(m) => { sessionStorage.setItem("tailor-job", JSON.stringify(m)); setTab("cv"); }} />
      )}
      {tab === "companies" && (
        <CompaniesTab companies={companies} setCompanies={setCompanies} appKey={appKey} say={say} />
      )}
      {tab === "cv" && (
        <CvTab cvs={cvs} setCvs={setCvs} appKey={appKey} say={say} matches={allMatches} />
      )}
      {tab === "settings" && settings && (
        <SettingsTab settings={settings} setSettings={setSettings} appKey={appKey} say={say} />
      )}

      {toast && <div className="toast">{toast}</div>}

      <nav className="tabbar">
        {[["radar", "Radar"], ["companies", "Companies"], ["cv", "CV Studio"], ["settings", "Settings"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>
            {label}
            {id === "radar" && newMatches.length > 0 && <em className="pip">{newMatches.length}</em>}
          </button>
        ))}
      </nav>
    </main>
  );
}

/* ---------- Sign in / Sign up ---------- */
function Gate({ onUnlock }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [domain, setDomain] = useState("Sales");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const DOMAIN_OPTIONS = ["Finance", "Sales", "Marketing", "IT & Technology",
    "Human Resources", "Operations", "Customer Success & Support", "Consulting & Strategy"];

  async function go() {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, inviteCode, domain })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      localStorage.setItem(NAME_STORE, j.username);
      await onUnlock(j.token);
    } catch (e) { setErr(e.message); }
    setBusy(false);
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
          </>
        )}
        <button className="primary" disabled={busy || !username || !password} onClick={go}>
          {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {err && <p className="err">{err}</p>}
        <button className="linklike" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}

/* ---------- Radar ---------- */
function RadarTab({ sweep, scanning, onScan, appKey, say, onTailor }) {
  const matches = sweep ? sweep.results.flatMap((r) => r.matches) : [];
  const manual = sweep ? sweep.results.filter((r) => r.status === "manual") : [];
  const when = sweep ? new Date(sweep.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <section className="pane">
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
          <p className="muted">{sweep ? `Last sweep ${when} · ${sweep.newCount} new since previous` : "Add your target companies in the Companies tab, then run your first sweep — after that it happens automatically at 5 PM."}</p>
          <div className="row">
            <button className="primary" onClick={onScan} disabled={scanning}>{scanning ? "Scanning…" : "Sweep now"}</button>
            <NotifyButton appKey={appKey} say={say} />
          </div>
        </div>
      </div>

      {matches.length > 0 && (
        <>
          <h3 className="section-label">Relevant openings</h3>
          <ul className="jobs">
            {matches.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)).map((m) => (
              <li key={m.id} className="job">
                <div className="job-main">
                  <span className="job-title">{m.title} {m.isNew && <em className="new">NEW</em>}</span>
                  <span className="job-meta">{m.company}{m.location ? ` · ${m.location}` : ""}</span>
                </div>
                <div className="job-actions">
                  <a className="ghost" href={m.url} target="_blank" rel="noreferrer">View</a>
                  <button className="ghost" onClick={() => onTailor(m)}>Tailor CV</button>
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
          <h3 className="section-label">No public job feed — quick manual check</h3>
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

/* ---------- Companies ---------- */
function CompaniesTab({ companies, setCompanies, appKey, say }) {
  const [name, setName] = useState("");
  async function save(list) {
    setCompanies(list);
    try { await api("/api/companies", appKey, { method: "POST", body: JSON.stringify({ companies: list }) }); }
    catch (e) { say(e.message); }
  }
  return (
    <section className="pane">
      <h2 className="pane-title">Target companies <span className="count">{companies.length}</span></h2>
      <p className="muted">The daily 5 PM sweep checks every company here. Start by adding the companies you'd love to work at — dream ones included.</p>
      {companies.length === 0 && (
        <div className="empty">Your list is empty. Add 10–30 target companies to give the radar something to sweep.</div>
      )}
      <div className="row">
        <input value={name} placeholder="Add a company, e.g. Databricks" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="primary" onClick={add} disabled={!name.trim()}>Add</button>
      </div>
      <ul className="companies">
        {companies.map((c) => (
          <li key={c.name}>
            <span>{c.name}</span>
            <button className="x" aria-label={`Remove ${c.name}`} onClick={() => save(companies.filter((x) => x.name !== c.name))}>×</button>
          </li>
        ))}
      </ul>
    </section>
  );
  function add() {
    const n = name.trim();
    if (!n || companies.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
    save([...companies, { name: n, slug: n.toLowerCase().replace(/[^a-z0-9]/g, "") }]);
    setName("");
  }
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
      if (f.name.endsWith(".docx") && window.mammoth) {
        const buf = await f.arrayBuffer();
        const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
        text = r.value;
      } else {
        text = await f.text();
      }
      if (!text.trim()) throw new Error("empty file");
      const cv = { id: String(Date.now()), name: f.name.replace(/\.(docx|txt|md)$/i, ""), text: text.slice(0, 40000), addedAt: new Date().toISOString() };
      await saveCvs([cv, ...cvs]);
      setBaseId(cv.id);
      say(`Saved "${cv.name}" — it can now be reworked for any role.`);
    } catch { say("Couldn't read that file. Use .docx or .txt (PDF isn't supported yet)."); }
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
        <input ref={fileRef} type="file" accept=".docx,.txt,.md" hidden onChange={onFile} />
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
          <div className="row">
            <button className="ghost" onClick={() => { navigator.clipboard.writeText(out); say("Copied."); }}>Copy</button>
            <button className="ghost" onClick={() => download("doc")}>Download .doc</button>
            <button className="ghost" onClick={() => download("txt")}>Download .txt</button>
          </div>
          <pre>{out}</pre>
        </div>
      )}

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

/* ---------- Settings ---------- */
function SettingsTab({ settings, setSettings, appKey, say }) {
  const [local, setLocal] = useState(settings);
  const upd = (k, v) => setLocal({ ...local, [k]: v });
  async function save() {
    try {
      await api("/api/settings", appKey, { method: "POST", body: JSON.stringify({ settings: local }) });
      setSettings(local); say("Saved. The next sweep uses these rules.");
    } catch (e) { say(e.message); }
  }
  return (
    <section className="pane">
      <h2 className="pane-title">Settings</h2>

      <label className="lbl">My profile (Claude uses this to tailor CVs)</label>
      <textarea rows={6} value={local.profile} onChange={(e) => upd("profile", e.target.value)} />

      <label className="lbl">A role matches if the title contains any of these</label>
      <textarea rows={3} value={local.includeKeywords.join(", ")}
        onChange={(e) => upd("includeKeywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />

      <label className="lbl">Skip roles containing</label>
      <textarea rows={2} value={local.excludeKeywords.join(", ")}
        onChange={(e) => upd("excludeKeywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />

      <label className="radio big">
        <input type="checkbox" checked={local.indiaOnly} onChange={(e) => upd("indiaOnly", e.target.checked)} />
        Only India-based (or remote) roles
      </label>

      <button className="primary wide" onClick={save}>Save settings</button>
    </section>
  );
}
