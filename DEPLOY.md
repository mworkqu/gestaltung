# Stage 1 — Run locally, push to GitHub, deploy to Vercel

The project is fully scaffolded in this folder (Next.js 15 + TypeScript + Tailwind + shadcn/ui).
Run these on YOUR computer (Windows). They can't run inside Claude's sandbox because npm
and git are restricted there.

Open PowerShell, then:

```powershell
cd "C:\Users\mmamr\Desktop\projects\Gestaltung company webpage\Gestaltung — a manufacturing marketplace and inventory platform for Qatar"
```

## 1) Run it locally
```powershell
npm install
npm run dev
```
Open http://localhost:3000  → you should see the Gestaltung landing page.
(Press Ctrl+C to stop.)

## 2) Push to a new GitHub repo
First remove the placeholder .git folder Claude created (it's empty/corrupt — the sandbox
couldn't finish it), then start fresh:
```powershell
Remove-Item -Recurse -Force .git
git init
git add .
git commit -m "Stage 1: scaffold + Gestaltung landing page"
git branch -M main
```
Create the repo and push. Easiest with the GitHub CLI:
```powershell
gh repo create gestaltung --public --source=. --remote=origin --push
```
Or, without gh: create an empty repo named `gestaltung` at https://github.com/new , then:
```powershell
git remote add origin https://github.com/<your-github-username>/gestaltung.git
git push -u origin main
```

## 3) Deploy to Vercel (your account is already connected: team "gestaltungco-7345's projects")

**Option A — GitHub integration (recommended, gives auto-deploy):**
1. Go to https://vercel.com/new
2. Import the `gestaltung` repo you just pushed.
3. Vercel auto-detects Next.js — click **Deploy**.
4. You get a live URL like `https://gestaltung.vercel.app`.

**Option B — Vercel CLI (fastest, no GitHub needed):**
```powershell
npm i -g vercel
vercel          # links the project and deploys a preview
vercel --prod   # promotes to your production URL
```

## ✅ Stage 1 checklist
- [ ] Site runs locally at http://localhost:3000
- [ ] Site is live on a Vercel URL (anyone can reach it)
- [ ] Edit `app/page.tsx`, then `git commit` + `git push` → Vercel auto-deploys (Option A)

Once all three are checked, you're ready for Stage 2 (bilingual shell + theme + logo).
