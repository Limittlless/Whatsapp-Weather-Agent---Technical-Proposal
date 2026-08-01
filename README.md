# WhatsApp Weather Agent

A WhatsApp AI assistant that answers weather questions using Google Gemini,
LangChain.js, and Supabase for conversation history. It can connect through
either the official Meta WhatsApp Cloud API or a `whatsapp-web.js` session.

## WhatsApp connection providers

Select the provider with `WHATSAPP_PROVIDER` and restart or redeploy the
service. Provider switching is not performed live.

### Meta Cloud API (default)

```env
WHATSAPP_PROVIDER=cloud_api
WHATSAPP_CLOUD_API_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
```

The Cloud API provider receives messages at `/webhook`. In production,
`WHATSAPP_APP_SECRET` is required so webhook signatures can be verified.

### WhatsApp Web

```env
WHATSAPP_PROVIDER=web_js
WHATSAPP_WEB_JS_AUTH_PATH=.wwebjs_auth
WHATSAPP_WEB_JS_RECONNECT_DELAY_MS=10000
# Optional: pin a version already verified in staging.
WHATSAPP_WEB_JS_WEB_VERSION=
```

On the first start, scan the QR code printed in the service logs. The
`web_js` provider ignores group and broadcast messages, reuses the same
authorization/admin/agent pipeline as Cloud API, and reconnects internally
after a disconnect. `whatsapp-web.js` automates WhatsApp Web and is not the
official Meta API.

For a local container, `docker compose up --build` stores the linked session
in the named `whatsapp-web-auth` volume. When running directly outside Docker,
set `PUPPETEER_EXECUTABLE_PATH` to a locally installed Chrome or Chromium
binary if Puppeteer has not downloaded its managed browser.

### Railway requirements for `web_js`

Before enabling `web_js` in Railway:

1. Add a persistent volume mounted at `/app/.wwebjs_auth`.
2. Set `WHATSAPP_WEB_JS_AUTH_PATH=/app/.wwebjs_auth`.
3. Keep the service at exactly one replica. Multiple replicas cannot safely
   share one WhatsApp Web session.
4. Verify that the selected plan has enough memory for Chromium.
5. Set `WHATSAPP_PROVIDER=web_js` and redeploy, then scan the QR code in the
   logs on the first start.

`railway.json` selects the Dockerfile builder so the Alpine Chromium packages
are installed. It also disables deployment overlap to avoid briefly running
two containers against the same session. Replica count and the persistent
volume are service settings and must be configured in the Railway dashboard.

## Admin-managed access

The bot can be restricted to users approved by configured administrators.
Apply `supabase/migrations/0003_create_authorized_users.sql`, then set
`ADMIN_WHATSAPP_NUMBERS` in Railway to a comma-separated list of administrator
WhatsApp IDs.

Administrators can manage access directly from WhatsApp:

```text
/auth add 212600000000 Ahmed
/auth remove 212600000000
/auth status 212600000000
/auth list
```

Administrator numbers always retain access. Other numbers must have an active
row in `authorized_users`; unauthorized messages are rejected before they
reach Gemini or conversation history.
