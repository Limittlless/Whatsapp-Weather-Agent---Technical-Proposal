#!/bin/sh
set -e

AUTH_PATH="${WHATSAPP_WEB_JS_AUTH_PATH:-/app/.wwebjs_auth}"

if [ -d "$AUTH_PATH" ]; then
  chown -R nodeapp:nodejs "$AUTH_PATH"

  for lockfile in SingletonLock SingletonCookie SingletonSocket; do
    find "$AUTH_PATH" -name "$lockfile" -exec rm -f {} \; 2>/dev/null || true
  done
fi

exec su-exec nodeapp:nodejs "$@"