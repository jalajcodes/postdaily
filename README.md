# PostDaily

A personal app that helps you post on LinkedIn every day, in your own voice. It is inspired by wiral.social.

- **AI writer:** you drop in a thought, a story or a link, and get 3 drafts (Story, Lesson and Opinion) in your voice.
- **Your style:** paste some of your past posts and it learns your style. You can edit the style guide, your topics and a "never say" list. Common AI clichés are always blocked.
- **Idea bank:** 5 fresh ideas arrive every morning, based on your niche and what you've posted recently. You can also save your own ideas.
- **Editor:** one-tap fixes (new hook, shorter, punchier, add CTA, ...) or a custom instruction, with undo/redo. A live LinkedIn preview shows where "…more" cuts the post, and a character counter enforces the 3000-character limit.
- **Queue:** you set weekly posting times once. "Add to queue" picks the next free slot, and you can also schedule an exact time or post now.
- **Streaks and reminders:** a daily streak, a weekly goal and a 12-week heatmap. If you haven't posted or queued anything by your reminder time, you get a macOS notification plus an in-app or browser notification.
- **Switchable AI:** you can use your Claude login (no API key needed), an Anthropic API key, OpenAI, or Ollama.

## Architecture (mobile-ready)

```
packages/shared   Types, typed API client, LinkedIn fold logic. Reusable by a future Expo / React Native app.
apps/api          Hono REST API, LinkedIn OAuth + Posts API, AI providers, scheduler
  src/app.ts        The app itself, shared by both runtimes
  src/node.ts       Mac/Node entry: SQLite file, Claude-login AI, macOS notifications, 1-minute timer
  src/worker.ts     Cloudflare entry: D1 database, Cron Trigger, web app served as static assets
  migrations/       Database schema (D1 migrations; the Node server applies them on start)
apps/web          React + Vite + Tailwind + TanStack Query
```

The same code runs in two places:

| | Mac (`npm run dev`) | Cloudflare (`npm run cf:deploy`) |
|---|---|---|
| Database | `apps/api/data/postdaily.db` | D1 |
| Scheduler | 60-second timer | Cron Trigger, every minute |
| AI providers | Claude login, Anthropic, OpenRouter, OpenAI, Ollama | OpenRouter (free models, default), Anthropic, OpenAI |
| Reminders | In-app, browser, macOS | In-app, browser |
| Sign-in | LinkedIn, or local login | LinkedIn only (first user or `ALLOWED_EMAILS`) |

The API is a plain REST service with bearer-token auth, so a mobile app can use the same endpoints and `@postdaily/shared` client. For mobile, the LinkedIn OAuth flow already accepts a `postdaily://` deep link as the redirect.

## Run it

```bash
cp .env.example .env    # then fill in what you need
npm install
npm run dev             # API on :8787, web on http://localhost:5173
```

You can start right away with **"Continue without LinkedIn (local)"** and the **Claude (my Claude login)** provider. That provider needs only a one-time `claude` sign-in in your terminal.

Production (single process that serves the web build):

```bash
npm run build && npm start   # http://localhost:8787 (set WEB_URL=http://localhost:8787)
```

The scheduler runs inside the API process, so scheduled posts only go out while it is running. To keep it always on for free, deploy to Cloudflare (below).

## Deploy to Cloudflare (free plan)

Run these from `apps/api` (`cd apps/api`). Wrangler is already a project dependency.

1. **Log in:** `npx wrangler login`
2. **Create the database:** `npx wrangler d1 create postdaily`. Copy the printed `database_id` into `apps/api/wrangler.jsonc`.
3. **Add secrets.** Each command asks you to paste the value:
   ```bash
   npx wrangler secret put LINKEDIN_CLIENT_ID
   npx wrangler secret put LINKEDIN_CLIENT_SECRET
   npx wrangler secret put OPENROUTER_API_KEY    # free models; and/or:
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put ALLOWED_EMAILS        # optional: your LinkedIn email; otherwise the first sign-in owns the app
   ```
4. **Deploy:** `npm run cf:deploy`. This builds the web app, applies database migrations, and deploys. It prints your URL, for example `https://postdaily.<you>.workers.dev`.
5. **LinkedIn:** in your LinkedIn app's **Auth** tab, add the redirect URL `https://postdaily.<you>.workers.dev/api/auth/linkedin/callback`.
6. Open the URL and sign in with LinkedIn. Your data starts empty on Cloudflare. Re-enter your style profile, then set your posting times (Queue → "Twice a day").

Notes:
- **Free plan fit:** 100k requests/day, a 1-minute cron, D1 (5M rows read and 100k written per day, 500 MB). PostDaily uses a tiny fraction of that. D1 queries fail for the rest of the day (until 00:00 UTC) if the free limits are ever exceeded.
- **Test locally first:** copy `.dev.vars.example` to `.dev.vars`, then run `npm run cf:dev` (Worker at http://localhost:8787 with a local D1). To fire the scheduler by hand: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`.
- **Don't schedule the same post in both places.** The Mac and Cloudflare versions have separate databases. If both are running, each publishes its own queue.

## LinkedIn setup (once)

1. Create an app at https://www.linkedin.com/developers/apps. It needs a LinkedIn Company Page; any page you admin works.
2. Under **Products**, add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Under **Auth**, add this redirect URL: `http://localhost:8787/api/auth/linkedin/callback`. If you change `API_URL`, use `API_URL` + `/api/auth/linkedin/callback` instead.
4. Copy the Client ID and Client Secret into `.env` as `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, then restart.
5. In the app, go to **Settings → Connect LinkedIn**.

LinkedIn access tokens last about 60 days. Settings shows the expiry date, and you reconnect when it runs out. Posts are published through the versioned `rest/posts` API. If LinkedIn retires the version, bump `LINKEDIN_API_VERSION` (YYYYMM).

## AI providers

| Provider | Needs | Default model |
|---|---|---|
| Claude (my Claude login) | `claude` CLI signed in (uses the Claude Agent SDK) | `claude-opus-5-5` |
| Anthropic API key | `ANTHROPIC_API_KEY` | `claude-opus-5-5` (server-side refusal fallback on) |
| OpenRouter | `OPENROUTER_API_KEY` (free at openrouter.ai/keys) | `particle-ai/particle-1:free` (fastest in a Nov 2026 test, ~9 s for 3 drafts), with fast free fallbacks. Settings lists all free models. |
| OpenAI | `OPENAI_API_KEY` | `gpt-5` |
| Ollama | Ollama running locally | `llama3.1` |

Switch providers or change the model in **Settings**. Prompts live in `apps/api/src/ai/writer.ts`.
