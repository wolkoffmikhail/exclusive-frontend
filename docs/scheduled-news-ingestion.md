# Scheduled News Ingestion

The scheduled loader exposes a protected endpoint:

```text
POST /api/news/ingest
```

It runs server-side with `SUPABASE_SERVICE_ROLE_KEY`, loads Bank of Russia RSS source documents, deduplicates them by `content_hash` and `source_id + external_id`, updates `news_sources.last_success_at/last_error`, and writes audit records with `actor_user_id = null`.

## Environment

Required:

```text
NEWS_INGEST_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_INTERNAL_URL=
```

Optional:

```text
NEWS_INGEST_CBR_LIMIT=20
NEWS_INGEST_FAMILY_LIMIT=25
NEWS_INGEST_FAMILY_IDS=
NEWS_INGEST_SYNC_MOEX_ALIASES=0
NEWS_INGEST_MOEX_ASSET_LIMIT=30
```

`NEWS_INGEST_FAMILY_IDS` is a comma-separated allowlist. When it is empty, the loader processes the first `NEWS_INGEST_FAMILY_LIMIT` families.

Set `NEWS_INGEST_SYNC_MOEX_ALIASES=1` to refresh MOEX aliases for portfolio assets after each news run. This improves later relevance linking, but adds external requests.

## Cron Command

Example hourly call:

```powershell
curl.exe -s -X POST "https://your-app.example.com/api/news/ingest" -H "Authorization: Bearer $env:NEWS_INGEST_SECRET"
```

For Coolify, configure this as an external scheduled job or service cron that calls the public app URL. The endpoint also accepts `GET` for schedulers that cannot send `POST`, but `POST` is preferred.

## Response

The endpoint returns JSON with per-family counts:

```json
{
  "ok": true,
  "familyCount": 1,
  "cbrFetchedCount": 20,
  "cbrFailedCount": 0,
  "results": []
}
```

HTTP `200` means all configured sources completed. HTTP `207` means at least one source failed but the run still recorded per-family status. HTTP `401` means the secret is invalid, and `503` means the secret is not configured.
