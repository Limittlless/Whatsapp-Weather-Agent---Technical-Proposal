#!/bin/sh
set -e

AUTH_PATH="${WHATSAPP_WEB_JS_AUTH_PATH:-/app/.wwebjs_auth}"

if [ -d "$AUTH_PATH" ]; then
  chown -R nodeapp:nodejs "$AUTH_PATH"

  find "$AUTH_PATH" \
    \( -name 'SingletonLock' -o -name 'SingletonCookie' -o -name 'SingletonSocket' \) \
    -exec rm -f {} + 2>/dev/null || true
fi

exec su-exec nodeapp:nodejs "$@"