#!/bin/sh
set -e

echo "==> prisma migrate deploy"
node_modules/.bin/prisma migrate deploy

echo "==> starting Next.js"
exec node server.js
