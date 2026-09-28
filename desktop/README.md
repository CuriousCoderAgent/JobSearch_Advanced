# JobRadar Desk

A Windows desktop app for running a senior sales job switch end to end: new openings at target companies, an application tracker, a CV library with per-job tailoring, an interview question bank, spoken/video answer practice with coaching, and a coach chat that knows the whole pipeline.

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

### Layout

- `src/main/` — Electron main process: JSON store, encrypted API key, IPC handlers, Claude calls (`ai.ts`, `coach.ts`), document import/export, and the job engine (`engine/`: ATS adapters, careers-page discovery, sweep).
- `src/preload/` — the `window.desk` bridge (`invoke` / `on`).
- `src/renderer/` — React UI: pages, the Whisper worker and delivery-metrics analysis (`lib/voice.ts`).
- `src/shared/types.ts` — types shared by both sides.
