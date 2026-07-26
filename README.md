# JobRadar Teams

A shareable version of JobRadar for a small circle of friends or colleagues. Each person creates their own account (protected by an invite code you share), picks their field — Finance, Sales, Marketing, IT & Technology, HR, Operations, Customer Success, or Consulting — and gets their own private radar:

- Their own target-company list (starts empty — they add the companies they want)
- Role keywords pre-loaded for their field, fully editable
- A daily 5 PM IST sweep with a push notification of new relevant openings
- A private CV Studio: Claude tailors a CV or cover letter for any role, fresh or reworking a CV they upload
- Nobody can see anyone else's companies, CVs, or matches

## Deploying (same flow as the original JobRadar)

1. **GitHub**: create a new private repo (e.g. `jobradar-teams`) and upload this folder's contents (folders `app`, `lib`, `public`, `scripts` + the loose files, with `package.json` at the top level)
2. **Vercel**: Add New → Project → pick the repo → Deploy. If you get a 404 afterwards, check Settings → Build and Deployment: Framework Preset must be **Next.js**, and Root Directory must point to where `package.json` lives
3. **Storage tab** → Create Database → Upstash Redis (free). Use a NEW database — do not share the one from your personal JobRadar. The app accepts either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` variable names automatically
4. **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` — your key (all members' CV Studio usage bills to this)
   - `SESSION_SECRET` — any long random string
   - `INVITE_CODE` — the code you'll share with your circle
   - `CRON_SECRET` — any long random string
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — push keys (generate a fresh pair the same way as before)
5. **Redeploy** after adding variables

## Onboarding someone

Send them three things: the app URL, the invite code, and this note:

> 1. Open the link in Safari → Share → Add to Home Screen → open from the icon
> 2. Create your account: username, password, invite code, and pick your field
> 3. Companies tab: add 10–30 companies you'd love to work at
> 4. Radar tab: run your first Sweep, then tap "Enable 5 PM alerts"
> 5. Settings: replace the profile placeholder with 4–5 lines about your experience — the CV Studio uses it

## Limits to know

- Capped at 25 member accounts (protects the free tiers and the daily sweep's time budget)
- The daily sweep runs everyone sequentially; on the Vercel free plan it fires once a day within the hour after 5 PM IST
- All Claude usage (CV tailoring) runs on YOUR API key — costs are small per CV, but they're yours; share accordingly
- Passwords are stored securely hashed; still, tell people to use a fresh password, not one they use elsewhere
