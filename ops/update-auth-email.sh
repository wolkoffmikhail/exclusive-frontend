#!/bin/sh
set -eu

USER_ID="${1:?Usage: update-auth-email.sh user_id email}"
EMAIL="${2:?Usage: update-auth-email.sh user_id email}"
APP_CONTAINER="$(docker ps \
  --filter label=coolify.applicationId=6 \
  --format '{{.Names}}' | head -n 1)"
SERVICE_KEY="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  "$APP_CONTAINER" | sed -n 's/^SUPABASE_SERVICE_ROLE_KEY=//p')"

if [ -z "$SERVICE_KEY" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY is missing" >&2
  exit 1
fi

PAYLOAD="$(printf '{"email":"%s","email_confirm":true,"user_metadata":{"display_name":"Михаил Волков"}}' "$EMAIL")"

curl --fail-with-body --silent --show-error \
  -X PUT "http://192.168.0.22:8012/auth/v1/admin/users/$USER_ID" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD" >/dev/null

docker exec supabase-db-m8c08w0csg4gwg8ksok480o4 \
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.profiles set display_name = 'Михаил Волков', updated_at = now() where user_id = '$USER_ID';"

echo "ADMIN_EMAIL=$EMAIL"
echo "USER_ID=$USER_ID"
