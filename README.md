# WhatsApp Weather Agent

A WhatsApp AI assistant that answers weather questions using Google Gemini,
LangChain.js, the Meta WhatsApp Cloud API, and Supabase for conversation
history.

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
