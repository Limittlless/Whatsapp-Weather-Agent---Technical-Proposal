#!/bin/sh
set -e

if [ -d /app/.wwebjs_auth ]; then
  chown -R nodeapp:nodejs /app/.wwebjs_auth
fi

exec su-exec nodeapp:nodejs "$@"