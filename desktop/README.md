# JobRadar Desk

A Windows desktop app for running a senior enterprise-sales move into an AI-first or tech-led company, end to end: new openings at target companies, an application tracker, a CV library with per-job tailoring, an interview question bank, spoken/video answer practice with coaching, and a coach who knows the whole pipeline and stays in your corner.

## What it does

- **Jobs radar** — watches your target companies' own job feeds (one-click lists of AI-first companies: OpenAI, Anthropic, Sarvam AI, Cohere, Glean…), sweeps by itself every 12 hours while open, and sends a Windows notification for new matches. Tracking a role pulls its full job description automatically.
- **Applications** — a kanban pipeline. "Save application pack" freezes the exact CV sent to that company (your master stays editable) and files the CV, cover letter and JD under `Documents\JobRadar Desk\Applications`, with a `CV register.csv` index of what went where. Reminders the day before any dated next step.
- **CV Studio** — master, drafts, tailored and sent versions; bulk import of old versions; a "Sent register" showing which CV each employer has.
- **Interview prep & practice** — a question bank including AI-company GTM questions, model answers and critiques, and recorded practice scored on structure, substance, presence and delivery. Tone analysis on the PC (pace, fillers, hedges, airtime, uptalk, energy fade, pace drift, vocal variety) feeds a "how you came across" read, and each attempt is compared with your earlier ones.
- **Coach** — a daily mood check-in shapes the morning brief; wins are logged as you make progress and brought up on hard days; the chat coach keeps notes it remembers across sessions (visible and deletable on the Coach page).

## Install (Windows)

1. Open the repo's **Releases** page (or the latest run of the *Desktop app (Windows installer)* workflow) and download `JobRadar-Desk-Setup-<version>.exe`.
2. Run it. The installer isn't code-signed, so SmartScreen may warn: choose **More info → Run anyway**.
3. On first launch, follow the four setup steps (about you, Anthropic API key, CV, target companies).
4. For practice recordings, allow camera and microphone for desktop apps in **Windows Settings → Privacy & security**.

Your files live in `Documents\JobRadar Desk` (CVs, application packs, practice recordings). App data and the downloaded speech model live in `%APPDATA%\JobRadar Desk`.

## What it costs to run

- **Job radar:** free for companies on public ATS feeds (Workday, Greenhouse, Lever, Ashby, SmartRecruiters, SuccessFactors, Oracle, Amazon). Custom careers pages are read with Claude Haiku 4.5, and only when the page actually changes. Only brand-new listings that pass the free keyword/location filter are judged by AI.
- **Coaching** (model answers, critiques, CV tailoring, practice feedback, daily brief, chat) uses Claude Opus 5. Every call is logged with its cost in Settings, and a monthly budget cap (default $20) stops AI calls when reached.
- **Speech-to-text** runs on the PC (Whisper base, ~80 MB, downloaded once). Audio and video never leave the machine; only the transcript, delivery metrics and a few still frames (video mode) are sent for feedback.

## Develop

```bash
cd desktop
npm install
npm run dev        # run with hot reload
npm run typecheck
npm run dist:win   # build the NSIS installer into release/ (run on Windows or in CI)
```

Pushing changes under `desktop/` runs `.github/workflows/desktop-windows.yml`, which builds the installer on `windows-latest` and publishes it as a GitHub release.

To try a build without touching your real data, point it at a throwaway folder: `JOBRADAR_TEST_DIR=C:\temp\jr npm run start` keeps app data and documents under that folder. Existing data is upgraded in place on first launch by `migrate()` in `src/main/ipc.ts` (additive only).

### Layout

- `src/main/` — Electron main process: JSON store, encrypted API key, IPC handlers, Claude calls (`ai.ts`, `coach.ts`), document import/export, and the job engine (`engine/`: ATS adapters, careers-page discovery, sweep).
- `src/preload/` — the `window.desk` bridge (`invoke` / `on`).
- `src/renderer/` — React UI: pages, the Whisper worker and delivery-metrics analysis (`lib/voice.ts`).
- `src/shared/types.ts` — types shared by both sides.
