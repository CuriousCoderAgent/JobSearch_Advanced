"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setStatus("busy");
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      setStatus("done");
    } catch (e) { setErr(e.message); setStatus("idle"); }
  }

  if (!token) {
    return (
      <main className="gate">
        <div className="gate-card">
          <span className="brand-mark big" aria-hidden="true" />
          <h1>JobRadar</h1>
          <p>This reset link is missing its token. Ask for a new one from the sign-in screen.</p>
          <a className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/">Back to sign in</a>
        </div>
      </main>
    );
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>JobRadar</h1>
        {status === "done" ? (
          <>
            <p>Your password has been updated.</p>
            <a className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/">Back to sign in</a>
          </>
        ) : (
          <>
            <p>Choose a new password.</p>
            <input type="password" placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="primary" disabled={status === "busy"} onClick={submit}>
              {status === "busy" ? "Saving…" : "Set new password"}
            </button>
            {err && <p className="err">{err}</p>}
          </>
        )}
      </div>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
