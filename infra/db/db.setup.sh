#!/usr/bin/env bash
set -euo pipefail

: "${APP_DB_NAME:?APP_DB_NAME is required}"
: "${APP_DB_USERNAME:?APP_DB_USERNAME is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

mongosh --quiet <<'MONGOSH'
const appDbName = process.env.APP_DB_NAME;
const appUsername = process.env.APP_DB_USERNAME;
const appPassword = process.env.APP_DB_PASSWORD;

if (!appDbName || !appUsername || !appPassword) {
  throw new Error('APP_DB_NAME, APP_DB_USERNAME, and APP_DB_PASSWORD are required');
}

const appDb = db.getSiblingDB(appDbName);

appDb.createUser({
  user: appUsername,
  pwd: appPassword,
  roles: [
    {
      role: 'readWrite',
      db: appDbName,
    },
    {
      role: 'dbAdmin',
      db: appDbName,
    },
  ],
});

appDb.createCollection('init');
MONGOSH
