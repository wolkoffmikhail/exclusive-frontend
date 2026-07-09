#!/bin/sh
set -eu

EMAIL="${1:?Usage: bootstrap-admin.sh email}"
APP_CONTAINER="$(docker ps \
  --filter label=coolify.applicationId=6 \
  --format '{{.Names}}' | head -n 1)"

if [ -z "$APP_CONTAINER" ]; then
  echo "Application container not found" >&2
  exit 1
fi

SERVICE_KEY="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  "$APP_CONTAINER" | sed -n 's/^SUPABASE_SERVICE_ROLE_KEY=//p')"

if [ -z "$SERVICE_KEY" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY is missing" >&2
  exit 1
fi

TEMP_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9_!@#%+=' | cut -c1-24)"
PAYLOAD="$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"display_name":"Администратор"}}' "$EMAIL" "$TEMP_PASSWORD")"

RESPONSE="$(curl --fail-with-body --silent --show-error \
  -X POST 'http://192.168.0.22:8012/auth/v1/admin/users' \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD")"

USER_ID="$(printf '%s' "$RESPONSE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -z "$USER_ID" ]; then
  echo "Could not read user id from Auth response" >&2
  exit 1
fi

DB_CONTAINER='supabase-db-m8c08w0csg4gwg8ksok480o4'

docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "insert into public.profiles(user_id, display_name) values ('$USER_ID', 'Администратор') on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();"

FAMILY_ID="$(docker exec "$DB_CONTAINER" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "insert into public.families(name, base_currency, created_by) values ('Инвестиционный портфель', 'RUB', '$USER_ID') returning id;")"

docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "insert into public.family_members(family_id, user_id, role, created_by) values ('$FAMILY_ID', '$USER_ID', 'admin', '$USER_ID');"

echo "ADMIN_EMAIL=$EMAIL"
echo "TEMP_PASSWORD=$TEMP_PASSWORD"
echo "USER_ID=$USER_ID"
echo "FAMILY_ID=$FAMILY_ID"
