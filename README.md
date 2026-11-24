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
apps/api          Hono + SQLite (better-sqlite3) REST API, LinkedIn OAuth + Posts API, AI providers, scheduler
apps/web          React + Vite + Tailwind + TanStack Query
```

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

The scheduler runs inside the API process, so scheduled posts only go out while it is running. To keep it running, use a small always-on box or a launchd agent on your Mac.

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
| OpenAI | `OPENAI_API_KEY` | `gpt-5` |
| Ollama | Ollama running locally | `llama3.1` |

Switch providers or change the model in **Settings**. Prompts live in `apps/api/src/ai/writer.ts`.
