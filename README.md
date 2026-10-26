# AI Knowledge Run

A full-screen pixel-campus runner for AI literacy. Students enter a nickname, automatically run forward, dodge varied obstacles, and choose between left/right glass answer panels. A wrong answer breaks the glass and ends the run. After failure, the game shows the correct answer and explanation, then the player restarts from 0. Best distance is retained in the leaderboard.

## Features

- Third-person pixel runner (not first-person)
- No webpage-style header
- 40 AI knowledge questions, shuffled every run
- Left/right answer gates with randomized answer positions
- Varied obstacles across three lanes: cones, crates, hurdles, planters, benches
- Keyboard controls: Left/Right (or A/D), Space/Up to jump, P to pause
- Failure explanation + correct answer
- Nickname-only entry; no account/password
- Shared leaderboard when Supabase is configured
- LocalStorage fallback when no database is configured
- Vercel-ready Next.js project

## 1. Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Without Supabase environment variables, the game still runs and uses a local browser-only leaderboard.

## 2. Add Supabase for a shared leaderboard

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy `.env.example` to `.env.local`.
5. Fill in:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Important: `SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it in browser code or rename it to a `NEXT_PUBLIC_...` variable.

Restart the dev server after changing `.env.local`.

## 3. Deploy to Vercel

### Git workflow (recommended)

1. Create a GitHub/GitLab/Bitbucket repository and push this project.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework should be detected as **Next.js**.
4. In **Project Settings → Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy.

Vercel will automatically create preview deployments for branches and deploy the production branch according to your project settings.

### CLI workflow

```bash
npm i -g vercel
vercel
```

For production:

```bash
vercel --prod
```

Configure the same Supabase variables in Vercel before the production deployment.

## 4. Reset the leaderboard

In Supabase SQL Editor, run:

```sql
truncate table public.runs restart identity cascade;
truncate table public.players restart identity cascade;
```

The same statements are in `supabase/reset.sql`.

## 5. Where to edit the game

- `components/Game.tsx` — runner physics, obstacles, glass gates, HUD, ranking UI
- `lib/questions.ts` — all 40 AI questions and explanations
- `app/globals.css` — pixel UI styling
- `app/api/*` — server API for players, runs, and leaderboard
- `supabase/schema.sql` — database schema

## Database behavior

A new attempt always starts at 0. The `runs` table records attempts. The `players` table stores only each nickname's best distance and best number of gates cleared. The leaderboard endpoint returns the top 20 by best distance.

## Hong Kong / Mainland China note

The code itself has no ChatGPT dependency and does not require a ChatGPT account. Once deployed on your own Vercel project/domain, students access your deployment directly.

For Hong Kong, Vercel plus a custom domain is usually a reasonable deployment path. If you later need dependable access from mainland China, test on the target school network before class: international hosting/CDN routes can vary, and a mainland-compliant hosting/CDN setup may be needed for reliable large-scale classroom use.
