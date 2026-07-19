# WhatsApp Weather Agent

A WhatsApp AI assistant that answers weather questions using Google Gemini,
LangChain.js, the Meta WhatsApp Cloud API, and Supabase for conversation
history.

This document covers what's needed to take the app from "working locally"
to "running in production on Railway, talking to a live WhatsApp number."

---

## Architecture (current state)

- **WhatsApp transport:** Meta WhatsApp Cloud API (webhook + Graph API
  sender in `src/gateways/`). There is no `whatsapp-web.js`/browser-session
  dependency anywhere in this codebase — that approach was dropped in favor
  of the official Cloud API, so there's nothing left to migrate away from.
- **Agent:** Gemini via `@langchain/google`, with two tools
  (`geocode_location`, `get_current_weather`) calling Open-Meteo's free
  APIs.
- **State:** Supabase (Postgres) stores conversation history
  (`conversations` table) and, as of this phase, processed message ids
  (`processed_messages` table, for de-duplication — see below).
- **Server:** Express, single process, stateless aside from the DB.

## What this phase adds

Production readiness and deployment wiring that a local/dev setup doesn't
need but a public, internet-facing webhook does:

| Area | What was added |
|---|---|
| Security | `X-Hub-Signature-256` verification on every webhook POST (`src/middleware/verifyMetaSignature.js`), so only requests actually signed by Meta are processed |
| Reliability | Message de-duplication (`src/services/processedMessages.js` + `supabase/migrations/0002_create_processed_messages.sql`) so Meta's webhook retries never cause a double reply |
| Hardening | `helmet` (security headers), `express-rate-limit` on `/webhook`, a 1MB body limit, a global error handler, and graceful shutdown on `SIGTERM`/`SIGINT` |
| Observability | `morgan` access logging (no message bodies/PII logged) |
| Deployment | `railway.json` (build/start/healthcheck/restart config) and `.nvmrc` / `engines` so Railway builds with the right Node version |

None of this changes the agent's behavior or existing tests — it's
additive. `npm test` should still pass; run `npm install` first so the
lockfile picks up the three new dependencies (`helmet`,
`express-rate-limit`, `morgan`).

---

## Environment variables

See `.env.example`. In production, set these as **Railway service
variables** (Project → your service → Variables), never commit a real
`.env`:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API. Use the **production** Supabase project, not a dev/test one. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google AI Studio / Vertex |
| `WHATSAPP_CLOUD_API_TOKEN` | Meta App → WhatsApp → API Setup. Use a **permanent** token (System User token from Meta Business Settings), not the 24h temporary token from the quick-start screen |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta App → WhatsApp → API Setup, the production phone number's ID |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose — must match exactly what you enter in the Meta webhook configuration screen |
| `WHATSAPP_APP_SECRET` | Meta App → Settings → Basic → App Secret. **Required** when `NODE_ENV=production`; the app refuses to start without it |
| `NODE_ENV` | `production` on Railway |
| `PORT` | Set automatically by Railway — no action needed, the app already reads `process.env.PORT` |

---

## Deploying to Railway

1. Push this repo to GitHub (or connect Railway directly to your existing repo).
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. Railway detects Node via Nixpacks automatically; `railway.json` in this
   repo tells it to run `npm start` and to healthcheck `/health`.
4. Add all the environment variables above under the service's
   **Variables** tab.
5. Deploy. Once it's live, Railway gives you a public URL like
   `https://<something>.up.railway.app` — this is your webhook base URL.
   (Optional: attach a custom domain under Settings → Networking.)
6. Confirm it's alive: `GET https://<your-domain>/health` → `{"status":"ok"}`.

## Wiring up Meta (production webhook)

1. In the Meta App Dashboard → WhatsApp → Configuration:
   - **Callback URL:** `https://<your-railway-domain>/webhook`
   - **Verify token:** exactly the value you put in `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and save** — this hits your `GET /webhook` handshake.
2. Subscribe to the `messages` webhook field.
3. Make sure the app/number is out of development-only mode for the people
   who need to use it:
   - If only testing with a handful of known numbers, add them as
     **testers** — no App Review needed.
   - For a genuinely public agent (anyone can message it), the app needs
     **App Review** approval for `whatsapp_business_messaging`, and the
     WhatsApp Business Account needs to complete **Meta Business
     verification**.
4. Confirm the WhatsApp Business Account has a permanent System User
   access token generated (not the temporary one) and that it's the value
   in `WHATSAPP_CLOUD_API_TOKEN`.

## Supabase production setup

1. Create (or confirm) the **production** Supabase project — separate
   from whatever you used in development.
2. Run both migrations against it, in order:
   - `supabase/migrations/0001_create_conversations.sql`
   - `supabase/migrations/0002_create_processed_messages.sql`
   (via `supabase db push`, the SQL editor, or your usual migration flow.)
3. Put that project's URL and service-role key into Railway's variables.

---

## Suggested division of work for this final phase

Based on what's already in the repo vs. what depends on accounts/access
only you or Mustafa can act on:

**Infra/product side (Meta & Supabase accounts, Railway project):**
- Create/confirm the production Meta App is linked to the real WhatsApp
  Business Account and phone number.
- Generate the permanent System User token; grab the App Secret.
- Decide and execute on App Review / Business Verification if the agent
  needs to serve the general public rather than a tester list.
- Create the production Supabase project and share its URL/service key.
- Create the Railway project, connect the GitHub repo, own the billing
  and custom domain if any.

**Engineering side (code already in this repo, ready to review/merge):**
- Review the security/reliability additions above (signature
  verification, dedup, rate limiting).
- Run `npm install && npm test` to confirm everything still passes with
  the new dependencies.
- Run the two Supabase migrations against the production project.
- Set the Railway environment variables and trigger the first deploy.
- Do the Meta webhook callback/verify-token configuration and the
  `messages` field subscription.
- Send a real test message end-to-end and confirm a reply arrives.

Whoever holds the Meta Business Manager / Supabase / Railway logins needs
to do the account-level steps; the code-level steps can be done by
either of you once those credentials exist.
